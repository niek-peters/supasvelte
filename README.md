# SupaSvelte

A simple, typesafe library that syncs Supabase Postgres data with Svelte stores in real time. Inspired by [SvelteFire](https://github.com/codediodeio/sveltefire).

```svelte
<script lang="ts">
  // ...imports
  // ...initialize Supabase client

  // get realtime data from the messages table
  const messages = getTableStore<Message>(supabaseClient, 'messages');
</script>

{#each $messages as message}
  <p>{message.text}</p>
{/each}
```

## Features

- Keep Svelte stores up to date with realtime database updates
- Automatically subscribe and unsubscribe from Supabase Realtime updates
- Provide your own or Supabase generated types for a completely typesafe experience:

```ts
getTableStore<Message, NewMessage, MutateMessage>(supabaseClient, "messages");
```

- Use methods on the store to easily modify the database tables:

```ts
const messages = getTableStore(supabaseClient, "messages");

const entry = {
  id: 1,
  text: "Hey there!",
};

// adds an entry to the table
messages.add({ text: entry.text }); 

// removes an entry from the table
messages.remove(entry.id); 

// mutates an existing entry in the table
messages.mutate(entry.id, { text: "New message" }); 
```

- Provide your own table index or primary key by setting the `indexName` option:

```ts
const messages = getTableStore(supabaseClient, "messages", {indexName: "uuid"});
```

- Decrease the amount of database requests by setting the `mutateInterval` option. This broadcasts changes to all connected clients without updating the database in case mutate requests are sent faster than the interval. After the interval is over or a client disconnects, the database will be updated. Useful for decreasing the load on the database for applications that make very frequent mutations to persistent data.

```ts
// Set a 10 second table mutation interval
const messages = getTableStore(supabaseClient, "messages", {mutateInterval: 10000});
```

- Run code after the mutation broadcasting channel is ready to receive updates using the `onReady` callback function:

```ts
const messages = getTableStore(supabaseClient, "messages", {indexName: "id"}, () => {
  console.log("Ready to broadcast!");
});
```

## Install

SvelteKit:
`npm i -D @niek-peters/supasvelte`

Svelte:
`npm i @niek-peters/supasvelte`

## Notes

- This package is intended for client-side use
- The traditional set and update methods from writable stores are intentionally unavailable
- This package is still **highly experimental** and will probably change a ton in the near future. Use at your own risk!
