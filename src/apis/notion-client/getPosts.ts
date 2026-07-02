import { CONFIG } from "site.config"
import { NotionAPI } from "notion-client"
import { idToUuid } from "notion-utils"

import getAllPageIds from "src/libs/utils/notion/getAllPageIds"
import getPageProperties from "src/libs/utils/notion/getPageProperties"
import { TPosts } from "src/types"
import { NOTION_GOT_OPTIONS, withNotionRetry } from "./notionOptions"

/**
 * @param {{ includePages: boolean }} - false: posts only / true: include pages
 */

// TODO: react query를 사용해서 처음 불러온 뒤로는 해당데이터만 사용하도록 수정
export const getPosts = async () => {
  let id = CONFIG.notionConfig.pageId as string
  const api = new NotionAPI()

  const response = await withNotionRetry(
    () => api.getPage(id, { gotOptions: NOTION_GOT_OPTIONS }),
    `NotionAPI getPage(${id})`
  )
  id = idToUuid(id)
  const collectionValue = Object.values(response.collection)[0]?.value as any
  const collection = collectionValue?.value ?? collectionValue
  const block = response.block
  const schema = collection?.schema

  const blockValue = (block[id].value as any)?.value ?? block[id].value
  const rawMetadata = blockValue

  // Check Type
  if (
    rawMetadata?.type !== "collection_view_page" &&
    rawMetadata?.type !== "collection_view"
  ) {
    return []
  } else {
    // Construct Data
    let pageIds = getAllPageIds(response)
    if (!pageIds.length) {
      const collectionId =
        rawMetadata?.collection_id ??
        rawMetadata?.format?.collection_pointer?.id ??
        Object.keys(response.collection)[0]
      const collectionViewId =
        rawMetadata?.view_ids?.[0] ?? Object.keys(response.collection_view)[0]
      const collectionViewValue = response.collection_view[collectionViewId]
        ?.value as any
      const collectionView = collectionViewValue?.value ?? collectionViewValue

      if (collectionId && collectionViewId && collectionView) {
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

        Object.assign(block, collectionData.recordMap.block)
        const reducerResults = (collectionData.result as any)?.reducerResults
        pageIds = reducerResults?.collection_group_results?.blockIds ?? []
      }
    }

    const data = []
    for (let i = 0; i < pageIds.length; i++) {
      const id = pageIds[i]
      const properties = (await getPageProperties(id, block, schema)) || null
      // Add fullwidth, createdtime to properties
      const pageBlockValue = (block[id].value as any)?.value ?? block[id].value
      properties.createdTime = new Date(pageBlockValue?.created_time).toString()
      properties.fullWidth =
        (pageBlockValue?.format as any)?.page_full_width ?? false

      data.push(properties)
    }

    // Sort by date
    data.sort((a: any, b: any) => {
      const dateA: any = new Date(a?.date?.start_date || a.createdTime)
      const dateB: any = new Date(b?.date?.start_date || b.createdTime)
      return dateB - dateA
    })

    const posts = data as TPosts
    return posts
  }
}
