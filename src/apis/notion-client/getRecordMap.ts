import { NotionAPI } from "notion-client"
import { ExtendedRecordMap } from "notion-types"
import { getBlockCollectionId, getPageContentBlockIds } from "notion-utils"
import { NOTION_GOT_OPTIONS, withNotionRetry } from "./notionOptions"

const RECORD_MAP_CHUNK_LIMIT = 1000
const MISSING_BLOCK_BATCH_SIZE = 100

const mergeRecordMapValues = (
  recordMap: ExtendedRecordMap,
  nextRecordMap: ExtendedRecordMap
) => {
  recordMap.block = {
    ...recordMap.block,
    ...nextRecordMap.block,
  }
  recordMap.collection = {
    ...recordMap.collection,
    ...nextRecordMap.collection,
  }
  recordMap.collection_view = {
    ...recordMap.collection_view,
    ...nextRecordMap.collection_view,
  }
  recordMap.notion_user = {
    ...recordMap.notion_user,
    ...nextRecordMap.notion_user,
  }
}

const unwrapRecordMapValues = (recordMap: ExtendedRecordMap) => {
  const unwrapMap = (map?: Record<string, any>) => {
    if (!map) return map

    return Object.fromEntries(
      Object.entries(map).map(([id, record]) => {
        const wrappedValue = record?.value
        if (wrappedValue?.value) {
          return [
            id,
            {
              ...record,
              role: record.role ?? wrappedValue.role,
              value: wrappedValue.value,
            },
          ]
        }
        return [id, record]
      })
    )
  }

  return {
    ...recordMap,
    block: unwrapMap(recordMap.block),
    collection: unwrapMap(recordMap.collection),
    collection_view: unwrapMap(recordMap.collection_view),
    notion_user: unwrapMap(recordMap.notion_user),
  } as ExtendedRecordMap
}

const chunk = <T>(items: T[], size: number) => {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

const fetchBlockBatch = async (
  api: NotionAPI,
  recordMap: ExtendedRecordMap,
  blockIds: string[]
) => {
  try {
    const response = await withNotionRetry(
      () => api.getBlocks(blockIds, NOTION_GOT_OPTIONS),
      `NotionAPI getBlocks(${blockIds.length})`
    )
    const nextRecordMap = unwrapRecordMapValues(
      response.recordMap as ExtendedRecordMap
    )
    mergeRecordMapValues(recordMap, nextRecordMap)
  } catch (error) {
    if (blockIds.length === 1) {
      console.warn(
        "NotionAPI getBlock error",
        blockIds[0],
        error instanceof Error ? error.message : error
      )
      return
    }

    const smallerBatchSize = Math.max(1, Math.ceil(blockIds.length / 2))
    for (const smallerBlockIds of chunk(blockIds, smallerBatchSize)) {
      await fetchBlockBatch(api, recordMap, smallerBlockIds)
    }
  }
}

const fetchMissingBlocks = async (
  api: NotionAPI,
  recordMap: ExtendedRecordMap
) => {
  const seenPendingSets = new Set<string>()

  while (true) {
    const pendingBlockIds = getPageContentBlockIds(recordMap).filter(
      (id) => !recordMap.block[id]
    )

    if (!pendingBlockIds.length) break

    const pendingKey = pendingBlockIds.join(",")
    if (seenPendingSets.has(pendingKey)) break
    seenPendingSets.add(pendingKey)

    for (const blockIds of chunk(pendingBlockIds, MISSING_BLOCK_BATCH_SIZE)) {
      await fetchBlockBatch(api, recordMap, blockIds)
    }
  }
}

const fetchCollections = async (
  api: NotionAPI,
  recordMap: ExtendedRecordMap,
  contentBlockIds: string[]
) => {
  const collectionInstances = contentBlockIds.flatMap((blockId) => {
    const block = recordMap.block[blockId]?.value
    const collectionId =
      block &&
      (block.type === "collection_view" ||
        block.type === "collection_view_page") &&
      getBlockCollectionId(block, recordMap)

    if (!collectionId) return []

    return (
      block.view_ids?.map((collectionViewId: string) => ({
        collectionId,
        collectionViewId,
      })) ?? []
    )
  })

  for (const { collectionId, collectionViewId } of collectionInstances) {
    const collectionView = recordMap.collection_view[collectionViewId]?.value

    try {
      const collectionData = await withNotionRetry(
        () =>
          api.getCollectionData(
            collectionId,
            collectionViewId,
            collectionView,
            {
              gotOptions: NOTION_GOT_OPTIONS,
            }
          ),
        `NotionAPI getCollectionData(${collectionId})`
      )
      const nextRecordMap = unwrapRecordMapValues(
        collectionData.recordMap as ExtendedRecordMap
      )
      mergeRecordMapValues(recordMap, nextRecordMap)

      recordMap.collection_query![collectionId] = {
        ...recordMap.collection_query![collectionId],
        [collectionViewId]: (collectionData.result as any)?.reducerResults,
      }
    } catch (error) {
      console.warn(
        "NotionAPI collectionQuery error",
        collectionId,
        (error as Error).message
      )
    }
  }
}

export const getRecordMap = async (pageId: string) => {
  const api = new NotionAPI()
  const page = await withNotionRetry(
    () =>
      api.getPageRaw(pageId, {
        chunkLimit: RECORD_MAP_CHUNK_LIMIT,
        gotOptions: NOTION_GOT_OPTIONS,
      }),
    `NotionAPI getPageRaw(${pageId})`
  )
  const recordMap = unwrapRecordMapValues(page.recordMap as ExtendedRecordMap)

  recordMap.collection = recordMap.collection ?? {}
  recordMap.collection_view = recordMap.collection_view ?? {}
  recordMap.notion_user = recordMap.notion_user ?? {}
  recordMap.collection_query = {}
  recordMap.signed_urls = {}

  await fetchMissingBlocks(api, recordMap)

  const contentBlockIds = getPageContentBlockIds(recordMap)
  await fetchCollections(api, recordMap, contentBlockIds)
  await api.addSignedUrls({
    recordMap,
    contentBlockIds,
    gotOptions: NOTION_GOT_OPTIONS,
  })

  return unwrapRecordMapValues(recordMap)
}
