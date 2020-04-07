import querystring from "query-string";
import _ from "lodash";
import { ReconnectingWebSocket } from "lib/ReconnectingWebSocket";
import { EventEmitter2 } from "eventemitter2";
import WebSocket from "ws";
import deltaParser from "lib/deltaParser";
import getStream from "lib/getStream";

const DEFAULT_MAX_TABLE_LEN = 10000;

const endpoints = {
    production: "wss://www.bitmex.com/realtime",
    testing: "wss://testnet.bitmex.com/realtime",
};

const noSymbolTables = [
    "account",
    "affiliate",
    "funds",
    "insurance",
    "margin",
    "transact",
    "wallet",
    "announcement",
    "connected",
    "chat",
    "publicNotifications",
    "privateNotifications",
];

// function addStreamHelper(
//     client: BitmexClient,
//     symbol: string,
//     tableName: string,
//     callback
// ) {
//     const tableUsesSymbol = noSymbolTables.indexOf(tableName) === -1;
//     if (!tableUsesSymbol) symbol = "*";

//     // Tell BitMEX we want to subscribe to this data. If wildcard, sub to all tables.
//     let toSubscribe;
//     if (tableName === "*") {
//         // This list comes from the getSymbols call, which hits
//         // https://www.bitmex.com/api/v1/schema/websocketHelp
//         toSubscribe = client.streams[client.authenticated ? "all" : "public"];
//     } else {
//         // Normal sub
//         toSubscribe = [tableName];
//     }

//     // For each subscription,
//     toSubscribe.forEach(function (table: string) {
//         // Create a subscription topic.
//         const subscription = `${table}:*:${symbol}`;

//         // Add the listener for deltas before subscribing at BitMEX.
//         // These events come from createSocket, which does minimal data parsing
//         // to figure out what table and symbol the data is for.
//         //
//         // The emitter emits 'partial', 'update', 'insert', and 'delete' events, listen to them all.
//         client.on(subscription, function (data) {
//             const [table, action, symbol] = this.event.split(":");

//             try {
//                 const newData = deltaParser.onAction(
//                     action,
//                     table,
//                     symbol,
//                     client,
//                     data
//                 );
//                 // Shift oldest elements out of the table (FIFO queue) to prevent unbounded memory growth
//                 if (newData.length > client._maxTableLen) {
//                     newData.splice(0, newData.length - client._maxTableLen);
//                 }
//                 callback(newData, symbol, table);
//             } catch (e) {
//                 client.emit("error", e);
//             }
//         });

//         // If this is the first sub, subscribe to bitmex adapter.
//         if (client.subscriptionCount(table, symbol) === 1) {
//             const openSubscription = () =>
//                 client.sendSubscribeRequest(table, symbol);
//             // If we reconnect, will need to reopen.
//             client.on("open", openSubscription);
//             // If we're already opened, prime the pump (I made that up)
//             if (client.socket.opened) openSubscription();
//         }
//     });
// }

export interface ClientOptions {
    url?: string;
    apiKey?: string;
    apiSecret?: string;
    maxTableLen?: number;
    testing?: boolean;
}

let nonceCounter = 0;

export default class BitmexClient extends EventEmitter2 {
    url: string;
    protected opened = false;
    private wsClient: ReconnectingWebSocket;
    protected event: string = "";

    public data: any = {};
    public keys: any = {};
    private listenerTree: any = {};
    private maxTableLen: number;
    private noSymbolTables: string[] = noSymbolTables;
    initialized: boolean = false;
    authenticated: any;
    streams: any;

    constructor(options: ClientOptions) {
        super({
            wildcard: true,
            delimiter: ":",
            maxListeners: Infinity,
            newListener: true,
        });
        this.maxTableLen = options.maxTableLen || DEFAULT_MAX_TABLE_LEN;

        if (!options.url) {
            options.url = options.testing
                ? endpoints.testing
                : endpoints.production;
        }

        if (process.env.BITMEX_URL) options.url = process.env.BITMEX_URL;
        this.setupListenerTracking();
        this.url = this.makeEndpoint(options);
        this.wsClient = new ReconnectingWebSocket(this.url);

        this.wsClient.onopen = () => {
            this.opened = true;
            this.emit("open");
        };

        this.wsClient.onclose = () => {
            this.opened = false;
            this.emit("close");
        };

        this.wsClient.onmessage = (ev: WebSocket.MessageEvent) => {
            let data;
            try {
                data = JSON.parse(ev.data.toString());
            } catch (e) {
                this.emit("error", "Unable to parse incoming data:", data);
                return;
            }

            if (data.error) return this.emit("error", data.error);
            if (!data.data) return; // connection or subscription notice

            return;
        };

        this.wsClient.onerror = (ev: WebSocket.ErrorEvent) => {
            const listeners = this.listeners("error");
            if (!listeners.length) throw ev.error;
            else this.emit("error", ev.error);
        };

        getStream(options.url)
            .then((streams) => {
                this.initialized = true;
                this.streams = streams;
                this.emit("initialize");
            })
            .catch((e) => {
                throw e;
            });
    }

    getData = (symbol: string | null, tableName?: string) => {
        const tableUsesSymbol =
            tableName && this.noSymbolTables.indexOf(tableName) === -1;
        if (!tableUsesSymbol) symbol = "*";
        let out;

        // Both filters specified, easy return
        if (symbol && tableName) {
            out = this.data[tableName][symbol] || [];
        }
        // Since we're keying by [table][symbol], we have to search deep
        else if (symbol && !tableName) {
            out = Object.keys(this.data).reduce(
                (memo: any, tableKey: string) => {
                    memo[tableKey] =
                        this.data[tableKey][symbol as string] || [];
                    return memo;
                },
                {}
            );
        }
        // All table data
        else if (!symbol && tableName) {
            out = this.data[tableName] || {};
        } else {
            throw new Error(
                "Pass a symbol, tableName, or both to getData([symbol], [tableName]) - but one must be provided."
            );
        }
        return _.cloneDeep(out);
    };

    getTable = (tableName: string) => this.getData(null, tableName);

    getSymbol = (symbol: string) => this.getData(symbol);

    addStream = (
        symbol: string,
        tableName: string,
        callback: (newData: any[], symbol: any, table: any) => any
    ): any => {
        if (!this.initialized) {
            return this.once("initialize", () =>
                this.addStream(symbol, tableName, callback)
            );
        }
        if (!this.opened) {
            // Not open yet. Call this when open
            return this.wsClient.once("open", () =>
                this.addStream(symbol, tableName, callback)
            );
        }

        // Massage arguments.
        if (typeof callback !== "function")
            throw new Error(
                "A callback must be passed to BitMEXClient#addStream."
            );
        else if (this.streams.all.indexOf(tableName) === -1) {
            throw new Error(
                "Unknown table for BitMEX subscription: " +
                    tableName +
                    ". Available tables are " +
                    this.streams.all +
                    "."
            );
        }

        this.addStreamHelper(symbol, tableName, callback);
    };

    subscriptionCount = (tableName: string, symbol: string) =>
        (this.listenerTree[tableName] &&
            this.listenerTree[tableName][symbol]) ||
        0;

    sendSubscribeRequest = (tableName: string, symbol: string) => {
        this.wsClient.send(
            JSON.stringify({ op: "subscribe", args: `${tableName}:${symbol}` })
        );
    };

    makeEndpoint(options: ClientOptions) {
        let endpoint = "" + options.url;
        if (options.apiKey && options.apiSecret) {
            endpoint +=
                "?" + this.getWSAuthQuery(options.apiKey, options.apiSecret);
        }
        return endpoint;
    }

    getWSAuthQuery(apiKey: string, apiSecret: string) {
        const nonce = Date.now() * 1000 + (nonceCounter++ % 1000); // prevents colliding nonces. Otherwise, use expires
        const query = {
            "api-nonce": nonce,
            "api-key": apiKey,
            "api-signature": module.exports(
                apiSecret,
                "GET",
                "/realtime",
                nonce
            ),
        };

        return querystring.stringify(query);
    }

    setupListenerTracking = () => {
        // Keep track of listeners.
        this.on("newListener", (eventName) => {
            const split = eventName.split(":");
            if (split.length !== 3) return; // other events

            const [table, , symbol] = split;
            if (!this.listenerTree[table]) this.listenerTree[table] = {};
            if (!this.listenerTree[table][symbol])
                this.listenerTree[table][symbol] = 0;
            this.listenerTree[table][symbol]++;
        });
        this.on("removeListener", (eventName) => {
            const split = eventName.split(":");
            if (split.length !== 3) return; // other events
            const [table, , symbol] = split;
            this.listenerTree[table][symbol]--;
        });
    };

    addStreamHelper = (
        symbol: string,
        tableName: string,
        callback: (newData: any[], symbol: any, table: any) => any
    ) => {
        const tableUsesSymbol = noSymbolTables.indexOf(tableName) === -1;
        if (!tableUsesSymbol) symbol = "*";

        // Tell BitMEX we want to subscribe to this data. If wildcard, sub to all tables.
        let toSubscribe;
        if (tableName === "*") {
            // This list comes from the getSymbols call, which hits
            // https://www.bitmex.com/api/v1/schema/websocketHelp
            toSubscribe = this.streams[this.authenticated ? "all" : "public"];
        } else {
            // Normal sub
            toSubscribe = [tableName];
        }

        // For each subscription,
        toSubscribe.forEach((table: string) => {
            // Create a subscription topic.
            const subscription = `${table}:*:${symbol}`;

            // Add the listener for deltas before subscribing at BitMEX.
            // These events come from createSocket, which does minimal data parsing
            // to figure out what table and symbol the data is for.
            //
            // The emitter emits 'partial', 'update', 'insert', and 'delete' events, listen to them all.
            this.on(subscription, (data) => {
                const [table, action, symbol] = this.event.split(":");

                try {
                    const newData = deltaParser.onAction(
                        action,
                        table,
                        symbol,
                        this,
                        data
                    );
                    // Shift oldest elements out of the table (FIFO queue) to prevent unbounded memory growth
                    if (newData.length > this.maxTableLen) {
                        newData.splice(0, newData.length - this.maxTableLen);
                    }
                    callback(newData, symbol, table);
                } catch (e) {
                    this.emit("error", e);
                }
            });

            // If this is the first sub, subscribe to bitmex adapter.
            if (this.subscriptionCount(table, symbol) === 1) {
                const openSubscription = () =>
                    this.sendSubscribeRequest(table, symbol);
                // If we reconnect, will need to reopen.
                this.on("open", openSubscription);
                // If we're already opened, prime the pump (I made that up)
                if (this.wsClient.opened) openSubscription();
            }
        });
    };
}
