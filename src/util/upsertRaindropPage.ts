import type { BlockEntity, PageEntity } from "@logseq/libs/dist/LSPlugin";
import { findPagesByRaindropID } from "../../src/queries/getBlockBy";
import Maybe, { nothing, just } from "true-myth/maybe";

import type { Annotation, Raindrop } from "./Raindrop";
import { alertDuplicatePageIdUsed } from "./notify";
import { formatRaindropToProperties } from "./pageFormatter";
import {
  filterBlocksWithProperty,
  someBlockHasProperty,
  upsertBlockProperties,
} from "./blocks";
import { settings } from "./settings";
import { applyAsyncFunc } from "./async";
import { raindropTransformer } from "./raindropTransformer";

const noAnnotationsProp = "noannotations";
// TODO: Make this a preference
// TODO: Update page names from one prefix to the next? maybe?
const logseqRaindropPrefix = "logseq-raindrop/";

const ioMaybeGetPageForRaindrop = async (
  r: Raindrop
): Promise<Maybe<PageEntity>> => {
  const pagesHavingId = (await findPagesByRaindropID(r.id)) as (PageEntity &
    Record<"createdAt", number>)[];

  if (pagesHavingId.length === 0) return nothing<PageEntity>();
  if (pagesHavingId.length > 1) alertDuplicatePageIdUsed(r);

  const sortedByAge = [...pagesHavingId].sort(
    (a, b) => a.createdAt - b.createdAt
  );
  const oldestPage = sortedByAge.at(0);

  return Maybe.of(oldestPage);
};

/**
 * Adds a new block (once) to let the user know that there are no annotations
 * to import for this raindrop.
 *
 * Only insert the paragraph if the noAnnotationsProp field is missing.
 * Sets that field every time.
 *
 * The property must be removed once there are annotations to import.
 */
const ioAddEmptyStateBlock = async (
  pageBlocks: BlockEntity[],
  pageUuid: string
) => {
  const pageHasBlockWithNoAnnotationProp = await someBlockHasProperty(
    pageBlocks,
    noAnnotationsProp
  );
  if (!pageHasBlockWithNoAnnotationProp) {
    await logseq.Editor.appendBlockInPage(
      pageUuid,
      "There's nothing to import from Raindrop. Write some notes in Raindrop and sync this page again to bring the notes into Logseq. Don't delete this block. It will be automatically cleaned up by the Raindrop plugin.",
      { properties: { [noAnnotationsProp]: true } }
    );
    logseq.Editor.exitEditingMode();
  }
};

const ioRemoveEmptyStateBlock = async (pageBlocks: BlockEntity[]) => {
  (await filterBlocksWithProperty(pageBlocks, noAnnotationsProp)).forEach(
    async (block) => {
      await logseq.Editor.removeBlock(block.uuid);
    }
  );
};

const ioCreateOrLoadPage = async (r: Raindrop) => {
  const maybeExistingPage = await ioMaybeGetPageForRaindrop(r);
  const formattedRaindropProperties = formatRaindropToProperties(r);

  if (maybeExistingPage.isJust) {
    logseq.App.pushState("page", { name: maybeExistingPage.value.name });
  } else {
    await logseq.Editor.createPage(
      logseqRaindropPrefix + r.title,
      {},
      { createFirstBlock: false, redirect: true }
    );
  }
  const propBlock = (await logseq.Editor.getCurrentPageBlocksTree()).at(0);
  await upsertBlockProperties(propBlock, formattedRaindropProperties);
};

const ioAddOrRemoveEmptyState = async (
  r: Raindrop,
  pageBlocks: BlockEntity[],
  currentPage: PageEntity
) => {
  if (r.annotations.length === 0) {
    ioAddEmptyStateBlock(pageBlocks, currentPage.uuid);
  } else {
    ioRemoveEmptyStateBlock(pageBlocks);
  }
};

const ioCreateAnnotationBlock = async (
  annotation: Annotation,
  currentPage: PageEntity
): Promise<BlockEntity> => {
  const highlightFormatted = settings.formatting_template
    .highlight()
    .replace("{text}", annotation.text)
    .replace("{color}", annotation.color);
  const noteFormatted = settings.formatting_template
    .annotation()
    .replace("{text}", annotation.note);

  return await logseq.Editor.appendBlockInPage(
    currentPage.uuid,
    `${highlightFormatted}\n\n${noteFormatted}`,
    {
      properties: {
        "annotation-id": annotation.id,
        "annotation-color": annotation.color,
      },
    }
  );
};

const upsertAnnotationBlocks = async (
  r: Raindrop,
  currentPage: PageEntity
): Promise<BlockEntity[]> => {
  const currentPageBlocksTree = await logseq.Editor.getCurrentPageBlocksTree();
  const knownRaindropAnnotationIds = new Set(
    currentPageBlocksTree
      .map((block) => block?.properties?.annotationId ?? (undefined as string))
      .filter((annotationId) => annotationId !== undefined)
  );

  const addedBlocks = await applyAsyncFunc(
    r.annotations,
    async (annotation) => {
      if (knownRaindropAnnotationIds.has(annotation.id))
        return Promise.resolve(nothing<BlockEntity>());
      return Maybe.of(await ioCreateAnnotationBlock(annotation, currentPage));
    }
  );

  return addedBlocks
    .filter((item) => item.isJust)
    .map((item) => item.isJust && item.value);
};

const getSingleRaindrop = async (id: Raindrop["id"]) => {
  try {
    return await fetch(`https://api.raindrop.io/rest/v1/raindrop/${id}`, {
      method: "GET",
      headers: new Headers({
        Authorization: `Bearer ${settings.access_token()}`,
        "Content-Type": "application/json",
      }),
    })
      .then((res) => {
        if (res.status !== 200) {
          throw new Error("Request not successful");
        }

        return res;
      })
      .then((res) => res.json())
      .then((parsed) => raindropTransformer(parsed["item"]))
      .then((transformed) => just(transformed));
  } catch {
    return nothing();
  }
};

export const upsertRaindropPage = async (r: Raindrop) => {
  const maybeRaindrop = await getSingleRaindrop(r.id);

  if (maybeRaindrop.isJust) {
    const fullRaindrop = maybeRaindrop.value;
    await ioCreateOrLoadPage(fullRaindrop);
    const pageBlocks = await logseq.Editor.getCurrentPageBlocksTree();
    const currentPage = await logseq.Editor.getCurrentPage();
    await ioAddOrRemoveEmptyState(
      fullRaindrop,
      pageBlocks,
      currentPage as PageEntity
    );
    await upsertAnnotationBlocks(fullRaindrop, currentPage as PageEntity);
  } else {
    logseq.UI.showMsg(
      "Error while trying to receive content from Raindrop API",
      "error"
    );
  }
};
