/* eslint-disable @typescript-eslint/no-explicit-any */
import { writable, type Readable, type Writable } from "svelte/store";
import type {
  PostgrestError,
  RealtimeChannel,
  SupabaseClient,
} from "@supabase/supabase-js";

export interface TableRow {
  [x: string]: any;
}

export interface SupabaseStore<
  Entries extends TableRow[],
  NewEntry extends TableRow,
  MutateEntry extends TableRow
> extends Readable<Entries> {
  add(this: void, value: NewEntry): Promise<PostgrestError | null>;
  remove(this: void, id: any): Promise<PostgrestError | null>;
  mutate(
    this: void,
    id: any,
    value: MutateEntry
  ): Promise<PostgrestError | null>;
  tableName: string;
  indexName: string;
  channel: RealtimeChannel;
}

/**
 * Get a store that contains realtime data from a table in your Supabase PostgreSQL database.
 *
 * It is possible to provide 3 generic types to this function:
 * - `Entry`: The type of the data that is stored in the table, including all columns from the table as fields
 * - `NewEntry`: The type of the data that can be added to the table (for example, without the `id` and nullable fields)
 * - `MutateEntry`: The type of the data that can be mutated in the table (for example, without the `id` and other fields that shouldn't be changed)
 *
 * The last two generics are optional, and will default to the `Entry` type, but without the `id` field.
 *
 * @param supabase An instance of the Supabase Client
 * @param tableName The name of the table you want to get data from
 * @param indexName The name of the table's primary key or index (default: `id`. If you change this, you should probably provide your own NewEntry and MutateEntry types)
 * @returns A store that contains realtime data from the table
 */
export function getTableStore<
  Entry extends TableRow,
  NewEntry extends TableRow = Omit<Entry, "id">,
  MutateEntry extends TableRow = NewEntry
>(
  supabase: SupabaseClient<any, "public", any>,
  tableName: string,
  indexName = "id"
): SupabaseStore<Entry[], NewEntry, MutateEntry> {
  const store: Writable<Entry[]> = writable([], () => {
    const supabaseStore = store as unknown as SupabaseStore<
      Entry[],
      NewEntry,
      MutateEntry
    >;
    supabaseStore.channel.subscribe();

    return () => {
      supabaseStore.channel.unsubscribe();
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

function getRealtimeChannel<Entry extends TableRow>(
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
