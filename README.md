# bitmex-websocket-api

Bitmex WebSocket Client

## install

```
npm install bitmex-websocket-api
```

## Usage

```typescript
import BitmexClient from "bitmex-websocket-api";

const ws = new BitmexClient({ apiKey: "api-key", apiSecret: "api-secret" });

ws.on("open", () => {
    console.log("is running...");
});

ws.on("close", () => {
    console.log("closing...");
});

ws.addStream("XBTUSD", "execution", async (data) => {
    console.log(data);
});
```
