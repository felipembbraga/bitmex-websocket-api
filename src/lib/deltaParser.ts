/**
 * A mixin that binds a store's data to a websocket.
 * Accepts multiple socket descriptors.
 * @param  {Object|Array} socketDescriptors Description of a socket connection.
 */

import _ from "lodash";
import BitmexClient from "BitmexClient";

export default {
    /**
     * Called when data comes in via the websocket.
     *
     * Returns new data. We ensure that the object identity check will fail by constructing a new array
     * or object whenever data updates.
     *
     * We handle four different kinds of events:
     *
     * 'partial': Replace the store entirely.
     * 'update': Iterate through items sent. Find the items that match those items (via keys)
     *           and replace them with new items. Do not merge properties; create new objects
     *           for faster shouldComponentUpdate.
     * 'insert': Insert a new item to the front or to the back.
     * 'delete': Delete an item from the store.
     *
     * @param  {String} action    Action name.
     * @param  {String} tableName Table to update.
     * @param  {String} symbol    Symbol we're updating (instrument).
     * @param  {Object} client    Client store.
     * @param  {Array}  data      Array of new data.
     * @return {Array}            Updated data.
     */
    onAction(
        action: string,
        tableName: string,
        symbol: string,
        client: BitmexClient,
        data: any
    ): Array<any> {
        // Deltas before the getSymbol() call returns can be safely discarded.
        if (action !== "partial" && !isInitialized(tableName, symbol, client))
            return [];
        // Partials initialize the table, so there's a different signature.
        if (action === "partial")
            return this._partial(tableName, symbol, client, data);

        // Some tables don't have keys, like 'trade' and 'quote'. They are insert-only tables
        // and you should never see updates or deletes on them.
        const keys = client.keys[tableName];
        if ((action === "update" || action === "delete") && keys.length === 0) {
            throw new Error(
                "The data in the store " +
                    tableName +
                    " is not keyed for " +
                    action +
                    "s. " +
                    "Please email support@bitmex.com if you see this."
            );
        }

        // This dispatches delete/insert/update.
        return module.exports["_" + action](
            client.data[tableName],
            symbol,
            data.data,
            client.keys[tableName]
        );
    },

    _delete(context: any, key: string, data: any[], keys: any[]) {
        return removeFromStore.apply(null, [context, key, data, keys]);
    },

    _insert(context: any, key: string, data: any[]) {
        return insertIntoStore.apply(null, [context, key, data]);
    },

    _partial(tableName: string, symbol: string, client: BitmexClient, data: any) {
        if (!client.data[tableName]) client.data[tableName] = {};
        const dataArr = data.data || [];
        // Intitialize data.
        // FIXME: we need to echo back `filter` with each partial, otherwise we can't tell the difference
        // between no data for a symbol and a partial for a different symbol.
        if (!client.data[tableName][symbol] || dataArr.length) {
            client.data[tableName][symbol] = dataArr;
        }
        // Initialize keys.
        client.keys[tableName] = data.keys;
        // Return inserted data
        return dataArr;
    },

    _update(context: any, key: string, data: any[], keys: any[]) {
        return updateStore.apply(null, [context, key, data, keys]);
    },
};

function isInitialized(
    tableName: string,
    symbol: string,
    client: BitmexClient
) {
    return client.data[tableName] && client.data[tableName][symbol];
}

/**
 * Add items  to a store.
 * @param  {Object} context Context.
 * @param  {String} key     Key of store.
 * @param  {Array}  newData Replacement data.
 * @param  {Array}  keys    Key names that uniquely identify a datum.
 */
function insertIntoStore(context: any, key: string, newData: Array<any>) {
    const store = context[key] || [];

    // Create a new working object.
    const storeData = ([].concat(store) as Array<any>).concat(newData);

    return replaceStore(context, key, storeData);
}

/**
 * Update items in a store.
 * @param  {Object} context Context.
 * @param  {String} key     Key of store.
 * @param  {Array}  newData Replacement data.
 * @param  {Array}  keys    Key names that uniquely identify a datum.
 */
function updateStore(
    context: any,
    key: string,
    newData: Array<any>,
    keys: Array<any>
) {
    const store = context[key] || [];

    // Create a new working object.
    const storeData: any = [].concat(store);

    // Loop through data, updating items in `storeData` when necessary.
    for (let i = 0; i < newData.length; i++) {
        let newDatum = newData[i];

        // Find the item we're updating, if it exists.
        const criteria = _.pick(newDatum, keys);
        const itemToUpdate = _.find(storeData, criteria);

        // If the item exists, replace it with an updated item.
        // This will actually replace the existing store with a new array
        // containing a completely new updated object. A little more GC work
        // but unique object references, for better shouldComponentUpdate.
        if (itemToUpdate) {
            newDatum = updateItem(itemToUpdate, newDatum);
            storeData[storeData.indexOf(itemToUpdate)] = newDatum;
        }
        // This is bad - the item didn't exist and we're trying to update it.
        // A lot of bad things can happen here since we basically have an incomplete
        // data set. An insert should have come first, but we can't treat this as an
        // insert because we'd end up with an item that has missing properties.
        else {
            throw new Error(
                "Update for missing item came through on " +
                    key +
                    ". Data: " +
                    JSON.stringify(newDatum)
            );
        }
    }

    return replaceStore(context, key, storeData);
}

/**
 * Removes items from a store.
 * @param  {Object} context Context.
 * @param  {String} key     Key of store.
 * @param  {Array}  newData Replacement data.
 * @param  {Array}  keys    Key names that uniquely identify a datum.
 */
function removeFromStore(
    context: any,
    key: string,
    newData: Array<any>,
    keys: Array<any>
) {
    const store = context[key] || [];

    // Create a new working object.
    let storeData: any = [].concat(store);

    // Loop through incoming data and remove items that match.
    for (let i = 0; i < newData.length; i++) {
        // Find the item to remove and remove it.
        const criteria = _.pick(newData[i], keys);
        const itemToRemove = _.find(storeData, criteria);
        storeData = _.without(storeData, itemToRemove);
    }

    return replaceStore(context, key, storeData);
}

/**
 * Replaces an object at a path with a new object.
 * @param  {Object} obj     Context.
 * @param  {String} key     Key of store.
 * @param  {Array}  newData New data.
 * @return {Object}         Context.
 */
function replaceStore(context: any, key: string, newData: any): object {
    // Store could be an array or singular object/model.
    if (!Array.isArray(context[key])) {
        // Not an array - simply replace with the first item in our new array.
        // This is for single object stores, like margin.
        context[key] = newData[0];
    } else {
        context[key] = newData;
    }
    return context[key];
}

/**
 * Update an item. Creates a new item, does not modify the old one.
 * @param  {Object|Model} item    Item to update.
 * @param  {Object} newData       Hash of new data.
 * @return {Object|Model}         A new item with new data.
 */
function updateItem(item: any, newData: any): object {
    return _.extend({}, item, newData);
}
