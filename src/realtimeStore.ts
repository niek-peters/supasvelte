/* eslint-disable @typescript-eslint/no-explicit-any */
import { writable, type Readable, type Writable } from "svelte/store";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

export interface DbRow {
  [x: string]: any;
}

export interface SupabaseStore<
  Entries extends DbRow[],
  NewEntry extends DbRow,
  MutateEntry extends DbRow
> extends Readable<Entries> {
  add: (value: NewEntry) => Promise<PostgrestError | null>;
  remove: (id: any) => Promise<PostgrestError | null>;
  mutate: (id: any, value: MutateEntry) => Promise<PostgrestError | null>;
  unsubscribe: () => void;
  tableName: string;
  indexName: string;
}

export function getStore<
  Entry extends DbRow,
  NewEntry extends DbRow = Omit<Entry, "id">,
  MutateEntry extends DbRow = NewEntry
>(
  supabase: SupabaseClient<any, "public", any>,
  tableName: string,
  indexName = "id"
): SupabaseStore<Entry[], NewEntry, MutateEntry> {
  const store: Writable<Entry[]> = writable([]);

  supabase
    .from(tableName)
    .select("*")
    .then((data) => store.set(data.data || []));

  const channel = supabase
    .channel("table-db-changes")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: tableName,
      },
      (payload) => {
        if (!(indexName in payload.new) && !(indexName in payload.old))
          console.error(`Index ${indexName} not found in payload`);

        switch (payload.eventType) {
          case "INSERT":
            store.update((data) => [...data, payload.new as Entry]);
            break;
          case "UPDATE":
            store.update((data) => {
              return data.map((item) =>
                item[indexName] === payload.new[indexName]
                  ? (payload.new as Entry)
                  : item
              );
            });
            break;
          case "DELETE":
            store.update((data) =>
              data.filter((item) => item[indexName] !== payload.old[indexName])
            );
            break;
        }
      }
    )
    .subscribe();

  const add = async (value: NewEntry) => {
    return (await supabase.from(tableName).insert(value)).error;
  };
  const remove = async (id: typeof indexName) => {
    return (await supabase.from(tableName).delete().eq(indexName, id)).error;
  };
  const mutate = async (id: typeof indexName, value: MutateEntry) => {
    return (await supabase.from(tableName).update(value).eq(indexName, id))
      .error;
  };
  const unsubscribe = () => {
    channel.unsubscribe();
  };

  const realtimeStore = store as unknown as SupabaseStore<
    Entry[],
    NewEntry,
    MutateEntry
  >;

  realtimeStore.add = add;
  realtimeStore.remove = remove;
  realtimeStore.mutate = mutate;
  realtimeStore.unsubscribe = unsubscribe;
  realtimeStore.tableName = tableName;
  realtimeStore.indexName = indexName;

  return realtimeStore;
}
