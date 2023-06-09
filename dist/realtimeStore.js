"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStore = void 0;
/* eslint-disable @typescript-eslint/no-explicit-any */
const store_1 = require("svelte/store");
function getStore(supabase, tableName, indexName = "id") {
    const store = (0, store_1.writable)([], () => {
        return store
            .unsubscribe;
    });
    supabase
        .from(tableName)
        .select("*")
        .then((data) => store.set(data.data || []));
    const channel = supabase
        .channel("table-db-changes")
        .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: tableName,
    }, (payload) => {
        if (!(indexName in payload.new) && !(indexName in payload.old))
            console.error(`Index ${indexName} not found in payload`);
        switch (payload.eventType) {
            case "INSERT":
                store.update((data) => [...data, payload.new]);
                break;
            case "UPDATE":
                store.update((data) => {
                    return data.map((item) => item[indexName] === payload.new[indexName]
                        ? payload.new
                        : item);
                });
                break;
            case "DELETE":
                store.update((data) => data.filter((item) => item[indexName] !== payload.old[indexName]));
                break;
        }
    })
        .subscribe();
    const add = async (value) => {
        return (await supabase.from(tableName).insert(value)).error;
    };
    const remove = async (id) => {
        return (await supabase.from(tableName).delete().eq(indexName, id)).error;
    };
    const mutate = async (id, value) => {
        return (await supabase.from(tableName).update(value).eq(indexName, id))
            .error;
    };
    const unsubscribe = () => {
        channel.unsubscribe();
    };
    const realtimeStore = store;
    realtimeStore.add = add;
    realtimeStore.remove = remove;
    realtimeStore.mutate = mutate;
    realtimeStore.unsubscribe = unsubscribe;
    realtimeStore.tableName = tableName;
    realtimeStore.indexName = indexName;
    return realtimeStore;
}
exports.getStore = getStore;
