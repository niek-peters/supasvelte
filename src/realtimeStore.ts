/* eslint-disable @typescript-eslint/no-explicit-any */
import { writable, type Readable, type Writable } from "svelte/store";
import type {
  PostgrestError,
  RealtimeChannel,
  SupabaseClient,
} from "@supabase/supabase-js";

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
  tableName: string;
  indexName: string;
  channel: RealtimeChannel;
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
  const store: Writable<Entry[]> = writable([], () => {
    return () => {
      (
        store as unknown as SupabaseStore<Entry[], NewEntry, MutateEntry>
      ).channel.unsubscribe();
    };
  });

  supabase
    .from(tableName)
    .select("*")
    .then((data) => store.set(data.data || []));

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
  const channel = getRealtimeChannel<Entry>(
    supabase,
    store,
    tableName,
    indexName
  );
  channel.subscribe();

  const realtimeStore = store as unknown as SupabaseStore<
    Entry[],
    NewEntry,
    MutateEntry
  >;

  realtimeStore.add = add;
  realtimeStore.remove = remove;
  realtimeStore.mutate = mutate;
  realtimeStore.tableName = tableName;
  realtimeStore.indexName = indexName;
  realtimeStore.channel = channel;

  return realtimeStore;
}

function getRealtimeChannel<Entry extends DbRow>(
  supabase: SupabaseClient<any, "public", any>,
  store: Writable<Entry[]>,
  tableName: string,
  indexName = "id"
) {
  return supabase.channel("table-db-changes").on(
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
          store.update((data: Entry[]) => [...data, payload.new as Entry]);
          break;
        case "UPDATE":
          store.update((data: Entry[]) => {
            return data.map((item: Entry) =>
              item[indexName] === payload.new[indexName]
                ? (payload.new as Entry)
                : item
            );
          });
          break;
        case "DELETE":
          store.update((data: Entry[]) =>
            data.filter(
              (item: Entry) => item[indexName] !== payload.old[indexName]
            )
          );
          break;
      }
    }
  );
}
