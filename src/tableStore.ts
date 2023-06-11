/* eslint-disable @typescript-eslint/no-explicit-any */
import { writable, type Readable, type Writable, get } from "svelte/store";
import type {
  PostgrestError,
  RealtimeChannel,
  RealtimeChannelSendResponse,
  SupabaseClient,
} from "@supabase/supabase-js";

export interface TableRow {
  [x: string]: any;
}

export interface TableStore<
  Entries extends TableRow[],
  NewEntry extends TableRow,
  MutateEntry extends TableRow
> extends Readable<Entries> {
  add(this: void, value: NewEntry): Promise<PostgrestError | null>;
  remove(this: void, id: string | number): Promise<PostgrestError | null>;
  mutate(
    this: void,
    id: string | number,
    value: MutateEntry
  ): Promise<PostgrestError | null>;
  tableName: string;
  indexName: string;
  postgresChannel: RealtimeChannel;
  broadcastChannel?: RealtimeChannel;
  mutateInterval?: number;
  lastMutate?: Date;
  unsavedIds: (string | number)[];
}

/**
 * Get a store that contains realtime data from a table in your Supabase PostgreSQL database. This store can also be used to add, remove and mutate data in the table and send store updates to all connected clients.
 *
 * It is possible to provide 3 generic types to this function:
 * - `Entry`: The type of the data that is stored in the table, including all columns from the table as fields
 * - `NewEntry`: The type of the data that can be added to the table (for example, without the `id` and nullable fields)
 * - `MutateEntry`: The type of the data that can be mutated in the table (for example, without the `id` and other fields that shouldn't be changed)
 *
 * The last two generics are optional, and will default to the `Entry` type, but without the `id` field.
 *
 * @param supabase An instance of the Supabase Client
 * @param tableName The name of the table you want to read/write data from/to
 * @param options An object with options for the store
 * @param options.indexName The name of the table's primary key or index (default: `id`. If you change this, you should probably provide your own NewEntry and MutateEntry types)
 * @param options.mutateInterval The interval in milliseconds between table mutations. When set to a value, calls to the mutate() function will send the update to all connected clients, but won't update the database. Will update the database after a certain time or when disconnecting automatically. Can be used to reduce database operations (default: `undefined`. Do not use negative numbers)
 * @param onReady A callback that will be called when channel for broadcasting mutations is ready to be used
 * @returns A store that contains realtime data from the table
 */
export function getTableStore<
  Entry extends TableRow,
  NewEntry extends TableRow = Omit<Entry, "id">,
  MutateEntry extends TableRow = NewEntry
>(
  supabase: SupabaseClient<any, "public", any>,
  tableName: string,
  options: {
    indexName?: string;
    mutateInterval?: number;
  } = { indexName: "id" },
  onReady?: () => void
): TableStore<Entry[], NewEntry, MutateEntry> {
  const indexName = options.indexName || "id";
  const mutateInterval = options.mutateInterval;

  const store: Writable<Entry[]> = writable([], () => {
    const tableStore = store as unknown as TableStore<
      Entry[],
      NewEntry,
      MutateEntry
    >;

    if (
      tableStore.postgresChannel.state !== "joined" &&
      tableStore.postgresChannel.state !== "joining"
    )
      tableStore.postgresChannel.subscribe();

    if (
      tableStore.broadcastChannel &&
      tableStore.broadcastChannel.state !== "joined" &&
      tableStore.broadcastChannel.state !== "joining"
    )
      tableStore.broadcastChannel.subscribe((status) => {
        if (status === "SUBSCRIBED" && onReady) onReady();
      });

    if (typeof window !== "undefined") {
      window.addEventListener(
        "beforeunload",
        () => {
          closeConnections<Entry>(supabase, tableStore, tableName, indexName);
        },
        {
          once: true,
        }
      );
    }

    return () => {
      closeConnections<Entry>(supabase, tableStore, tableName, indexName);
    };
  });

  supabase
    .from(tableName)
    .select("*")
    .then((data) => store.set(data.data || []));

  const tableStore = store as unknown as TableStore<
    Entry[],
    NewEntry,
    MutateEntry
  >;

  const add = async (value: NewEntry) => {
    return (await supabase.from(tableName).insert(value)).error;
  };
  const remove = async (id: string | number) => {
    return (await supabase.from(tableName).delete().eq(indexName, id)).error;
  };
  const mutate = async (id: string | number, value: MutateEntry) => {
    if (!id) throw new Error("No id provided");

    // If the mutateInterval is set, and the last mutate was less than the mutateInterval ago,
    // we don't want to mutate the table again, but instead broadcast the change to all clients
    if (
      tableStore.broadcastChannel &&
      tableStore.broadcastChannel.state === "joined" &&
      tableStore.mutateInterval
    ) {
      const now = new Date();
      if (
        tableStore.lastMutate &&
        now.getTime() - tableStore.lastMutate.getTime() <
          tableStore.mutateInterval
      ) {
        let res: RealtimeChannelSendResponse | null = null;
        let attempts = 0;

        while (res !== "ok" && attempts < 10) {
          res = await tableStore.broadcastChannel.send({
            type: "broadcast",
            event: `${tableName}-mutate`,
            entry: {
              [indexName]: id,
              ...value,
            },
          });
          await new Promise((resolve) => setTimeout(resolve, 100));

          attempts++;
        }

        tableStore.unsavedIds = [...tableStore.unsavedIds, id];
        return null;
      } else {
        tableStore.lastMutate = now;
      }
    }

    const savedIds = await saveUnsavedEntries(
      supabase,
      tableStore,
      tableName,
      indexName
    );
    if (savedIds.includes(id)) return null;
    return (await supabase.from(tableName).update(value).eq(indexName, id))
      .error;
  };
  const postgresChannel = getRealtimePostgresChannel<Entry>(
    supabase,
    store,
    tableName,
    options.indexName
  );
  let broadcastChannel: RealtimeChannel | undefined = undefined;
  if (options.mutateInterval) {
    broadcastChannel = getRealtimeBroadcastChannel<Entry>(
      supabase,
      store,
      tableName,
      options.indexName
    );
  }

  tableStore.add = add;
  tableStore.remove = remove;
  tableStore.mutate = mutate;
  tableStore.tableName = tableName;
  tableStore.indexName = indexName;
  tableStore.mutateInterval = mutateInterval;
  tableStore.postgresChannel = postgresChannel;
  tableStore.broadcastChannel = broadcastChannel;
  tableStore.unsavedIds = [];

  return tableStore;
}

function getRealtimePostgresChannel<Entry extends TableRow>(
  supabase: SupabaseClient<any, "public", any>,
  store: Writable<Entry[]>,
  tableName: string,
  indexName = "id"
) {
  return supabase.channel(`${tableName}-table-changes`).on(
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
          store.update((data: Entry[]) =>
            data.map((item: Entry) =>
              item[indexName] === payload.new[indexName]
                ? (payload.new as Entry)
                : item
            )
          );
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

function getRealtimeBroadcastChannel<Entry extends TableRow>(
  supabase: SupabaseClient<any, "public", any>,
  store: Writable<Entry[]>,
  tableName: string,
  indexName = "id"
) {
  return supabase
    .channel(`${tableName}-broadcast-changes`, {
      config: {
        broadcast: {
          self: true,
        },
      },
    })
    .on(
      "broadcast",
      {
        event: `${tableName}-mutate`,
      },
      (payload) => {
        store.update((data: Entry[]) =>
          data.map((item: Entry) =>
            item[indexName] === payload[indexName]
              ? (payload.entry as Entry)
              : item
          )
        );
      }
    );
}

async function saveUnsavedEntries<Entry extends TableRow>(
  supabase: SupabaseClient<any, "public", any>,
  tableStore: TableStore<Entry[], any, any>,
  tableName: string,
  indexName: string
): Promise<(string | number)[]> {
  let savedIds: (string | number)[] = [];
  if (tableStore.unsavedIds && tableStore.unsavedIds.length) {
    tableStore.unsavedIds = [...new Set(tableStore.unsavedIds)];

    for (const unsavedId of tableStore.unsavedIds) {
      const unsavedEntry = structuredClone(
        get(tableStore).find((entry) => entry[indexName] === unsavedId)
      );
      if (!unsavedEntry) continue;

      delete unsavedEntry[indexName];
      const { error } = await supabase
        .from(tableName)
        .update(unsavedEntry)
        .eq(indexName, unsavedId);

      if (!error) savedIds = [...savedIds, unsavedId];
    }

    tableStore.unsavedIds = tableStore.unsavedIds.filter(
      (id) => !savedIds.includes(id)
    );
  }

  return savedIds;
}

function closeConnections<Entry extends TableRow>(
  supabase: SupabaseClient<any, "public", any>,
  tableStore: TableStore<Entry[], any, any>,
  tableName: string,
  indexName: string
) {
  tableStore.postgresChannel.unsubscribe();
  if (
    tableStore.broadcastChannel &&
    tableStore.broadcastChannel.state === "joined"
  ) {
    saveUnsavedEntries(supabase, tableStore, tableName, indexName).then(() => {
      if (tableStore.broadcastChannel) {
        tableStore.broadcastChannel.unsubscribe();
      }
    });
  }
}
