import { type Readable } from "svelte/store";
import type { PostgrestError, RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
export interface DbRow {
    [x: string]: any;
}
export interface SupabaseStore<Entries extends DbRow[], NewEntry extends DbRow, MutateEntry extends DbRow> extends Readable<Entries> {
    add: (value: NewEntry) => Promise<PostgrestError | null>;
    remove: (id: any) => Promise<PostgrestError | null>;
    mutate: (id: any, value: MutateEntry) => Promise<PostgrestError | null>;
    tableName: string;
    indexName: string;
    channel: RealtimeChannel;
}
export declare function getStore<Entry extends DbRow, NewEntry extends DbRow = Omit<Entry, "id">, MutateEntry extends DbRow = NewEntry>(supabase: SupabaseClient<any, "public", any>, tableName: string, indexName?: string): SupabaseStore<Entry[], NewEntry, MutateEntry>;
