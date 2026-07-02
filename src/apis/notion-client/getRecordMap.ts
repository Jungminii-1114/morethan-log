import { NotionAPI } from "notion-client"
import { ExtendedRecordMap } from "notion-types"

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

export const getRecordMap = async (pageId: string) => {
  const api = new NotionAPI()
  const recordMap = await api.getPage(pageId)
  return unwrapRecordMapValues(recordMap)
}
