<script lang="ts">
  import Raindrop from "../atoms/Raindrop.svelte";
  import LoadingSpinner from "../atoms/LoadingSpinner.svelte";
  import { onMount } from "svelte";
  import { writable, derived } from "svelte/store";
  import { settings } from "../util/settings";
  import { upsertRaindropPage } from "../util/upsertRaindropPage";
  import { raindropTransformer } from "../util/raindropTransformer";

  const l = window?.logseq ?? {};

  const remoteData = writable([]);
  const requestsInFlight = writable(0);
  const mostRecentRequestTime = writable(new Date(0));
  const loading = derived(
    requestsInFlight,
    ($requestsInFlight) => $requestsInFlight > 0
  );

  const performSearch = async (term: string): void => {
    const requestTime = new Date();
    requestsInFlight.update((n) => n + 1);
    
    const res = await fetch(
      `https://api.raindrop.io/rest/v1/raindrops/0?search=${term}`,
      {
        method: "GET",
        headers: new Headers({
          Authorization: `Bearer ${settings.access_token()}`,
          "Content-Type": "application/json",
        }),
      }
    );
    const { items } = await res.json();
    // do some work
    requestsInFlight.update((n) => n - 1);
    mostRecentRequestTime.update((currentRequestTime) => {
      if (requestTime < currentRequestTime) return currentRequestTime;
      remoteData.update((_) => items.map(raindropTransformer));
      return requestTime;
    });
  };
  const onSearch = (event): void => performSearch(event.target.value);

  onMount(() => {
    performSearch("");
  });
</script>

<div>
  <h3>Import specific page</h3>
  <div class="searchField">
    {#if $loading}
      <LoadingSpinner size={24} duration={"2s"} color={"#1888df"} />
    {:else}
      <span class="loading__placeholder" />
    {/if}
    <input placeholder="Search" on:input={onSearch} />
  </div>

  <div class="scrollable">
    <ul class="results">
      {#each $remoteData as result}
        <li role="option">
          <Raindrop
            full={true}
            title={result.title}
            description={result?.description}
            annotations={result?.annotations}
            tags={result?.tags}
            url={result?.url}
            created={result?.created}
            collectionName={result?.collectionName}
            coverImage={result?.coverImage}
            onClick={() => upsertRaindropPage(result)}
          />
        </li>
      {/each}
    </ul>
  </div>
</div>

<style>
  .scrollable {
    max-height: calc(100vh - 450px);
    margin-top: 0.5rem;
    padding-right: 0.3rem;
    overflow-y: auto;
  }

  .loading__placeholder {
    width: 1.5rem;
    height: 1.5rem;
    margin: 0.5rem;
  }

  input:active,
  input:focus,
  input:focus-within,
  input:target,
  input:focus-visible {
    border: none;
    outline: none;
  }

  input {
    width: auto;
    background: none;
    color: var(--rd-primary-text-color);
    border: none;
  }

  .searchField {
    display: grid;
    grid-template-columns: auto 1fr;
    border: 2px solid transparent;
    border-radius: 4px;
    background-color: var(--rd-primary-background-color);
  }

  .searchField:focus-visible,
  .searchField:focus-within {
    border: 2px solid var(--rd-blue-base-color);
  }

  .results {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  ul {
    margin: 0;
    padding: 0;
  }

  li {
    list-style: none;
  }

  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }
</style>
