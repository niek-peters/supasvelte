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

messages.add({ text: entry.text }); // adds an entry to the table
messages.remove(entry.id); // removes an entry from the table
messages.mutate(entry.id, { text: "New message" }); // mutates an existing entry in the table
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
