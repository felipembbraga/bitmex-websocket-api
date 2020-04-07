import WebSocket from "ws";

/**
 * Forked from https://github.com/daviddoran/typescript-reconnecting-websocket
 */
export class ReconnectingWebSocket {
    //These can be altered by calling code
    public debug: boolean = false;
    //Time to wait before attempting reconnect (after close)
    public reconnectInterval: number = 1000;
    //Time to wait for WebSocket to open (before aborting and retrying)
    public timeoutInterval: number = 2000;
    //Should only be used to read WebSocket readyState
    public readyState: number;
    //Whether WebSocket was forced to close by this client
    private forcedClose: boolean = false;
    //Whether WebSocket opening timed out
    private timedOut: boolean = false;
    //List of WebSocket sub-protocols
    private protocols: string[] = [];
    //The underlying WebSocket
    private ws?: WebSocket;
    private url: string;
    public opened: boolean = false;
    /**
     * Setting this to true is the equivalent of setting all instances of ReconnectingWebSocket.debug to true.
     */
    public static debugAll = false;
    //Set up the default 'noop' event handlers
    public onopen: (ev: WebSocket.OpenEvent) => void = function (
        _event: WebSocket.OpenEvent
    ) {};
    public onclose: (ev: WebSocket.CloseEvent) => void = function (
        _event: WebSocket.CloseEvent
    ) {};
    public onconnecting: () => void = function () {};
    public onmessage: (ev: WebSocket.MessageEvent) => void = function (
        _event: WebSocket.MessageEvent
    ) {};
    public onerror: (ev: WebSocket.ErrorEvent) => void = function (
        _event: WebSocket.ErrorEvent
    ) {};
    
    constructor(url: string, protocols: string[] = []) {
        this.url = url;
        this.protocols = protocols;
        this.readyState = WebSocket.CONNECTING;
        this.connect(false);
    }
    public connect(reconnectAttempt: boolean) {
        this.ws = new WebSocket(this.url, this.protocols);
        this.onconnecting();
        this.log("ReconnectingWebSocket", "attempt-connect", this.url);
        var localWs = this.ws;
        var timeout = setTimeout(() => {
            this.log("ReconnectingWebSocket", "connection-timeout", this.url);
            this.timedOut = true;
            localWs.close();
            this.timedOut = false;
        }, this.timeoutInterval);
        this.ws.onopen = (event: WebSocket.OpenEvent) => {
            this.opened = true;
            clearTimeout(timeout);
            this.log("ReconnectingWebSocket", "onopen", this.url);
            this.readyState = WebSocket.OPEN;
            reconnectAttempt = false;
            this.onopen(event);
        };
        this.ws.onclose = (event: WebSocket.CloseEvent) => {
            clearTimeout(timeout);
            this.opened = false;
            this.ws = undefined;
            if (this.forcedClose) {
                this.readyState = WebSocket.CLOSED;
                this.onclose(event);
            } else {
                this.readyState = WebSocket.CONNECTING;
                this.onconnecting();
                if (!reconnectAttempt && !this.timedOut) {
                    this.log("ReconnectingWebSocket", "onclose", this.url);
                    this.onclose(event);
                }
                setTimeout(() => {
                    this.connect(true);
                }, this.reconnectInterval);
            }
        };
        this.ws.onmessage = (event) => {
            this.log(
                "ReconnectingWebSocket",
                "onmessage",
                this.url,
                event.data
            );
            this.onmessage(event);
        };
        this.ws.onerror = (event: WebSocket.ErrorEvent): any => {
            this.log("ReconnectingWebSocket", "onerror", this.url, event);
            this.onerror(event);
            return;
        };

    }

    public once: (
        ev: string | symbol,
        listener: (...args: any[]) => void
    ) => void = (
        event: string | symbol,
        listener: (...args: any[]) => void
    ) => {
        return this.ws?.once(event, listener);
    };

    public send(data: any) {
        if (this.ws) {
            this.log("ReconnectingWebSocket", "send", this.url, data);
            return this.ws.send(data);
        } else {
            throw "INVALID_STATE_ERR : Pausing to reconnect websocket";
        }
    }
    /**
     * Returns boolean, whether websocket was FORCEFULLY closed.
     */
    public close(): boolean {
        if (this.ws) {
            this.forcedClose = true;
            this.ws.close();
            return true;
        }
        return false;
    }
    /**
     * Additional public API method to refresh the connection if still open (close, re-open).
     * For example, if the app suspects bad data / missed heart beats, it can try to refresh.
     *
     * Returns boolean, whether websocket was closed.
     */
    public refresh(): boolean {
        if (this.ws) {
            this.ws.close();
            return true;
        }
        return false;
    }
    private log(message: any, ...args: any[]) {
        if (this.debug || ReconnectingWebSocket.debugAll) {
            console.debug.apply(console, [message, ...args]);
        }
    }
}
