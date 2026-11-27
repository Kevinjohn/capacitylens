import { HttpContext } from '@adonisjs/core/http'
import { BaseSerializer } from '@adonisjs/core/transformers'
import { type SimplePaginatorMetaKeys } from '@adonisjs/lucid/types/querybuilder'
import type {
  CollectionContract,
  ItemContract,
  PaginatorContract,
} from '@adonisjs/core/types/transformers'

/** Wraps every serialised answer in `data`, as the AdonisJS API starter kit does. */
class ApiSerializer extends BaseSerializer<{
  Wrap: 'data'
  PaginationMetaData: SimplePaginatorMetaKeys
}> {
  wrap: 'data' = 'data'

  definePaginationMetaData(metaData: unknown): SimplePaginatorMetaKeys {
    if (!this.isLucidPaginatorMetaData(metaData)) {
      throw new Error(
        'Invalid pagination metadata. Expected metadata to contain Lucid pagination keys'
      )
    }
    return metaData as SimplePaginatorMetaKeys
  }
}

const serializer = new ApiSerializer()

type Resource =
  ItemContract<any, any, any> | CollectionContract<any, any, any> | PaginatorContract<any, any, any>

/**
 * Types a plain object answer as wrapped. The serializer wraps every non-array object at run time,
 * but its own record overload only matches JSON-typed records, so interfaces, `Date` and optional
 * fields would otherwise fall to its untyped overload and the route registry would lose `data`.
 */
type SerializePlainObject = <Data extends object>(
  data: Data extends Resource | readonly unknown[] ? never : Data,
  resolver?: Parameters<ApiSerializer['serialize']>[1]
) => Promise<{ data: Data }>

/** Serialises a controller's 2xx answer as `{ data }`; `withoutWrapping` sends it as it is. */
const serialize = Object.assign(
  function (this: HttpContext, ...[data, resolver]: Parameters<ApiSerializer['serialize']>) {
    return serializer.serialize(data, resolver ?? this.containerResolver)
  },
  {
    withoutWrapping(
      this: HttpContext,
      ...[data, resolver]: Parameters<ApiSerializer['serializeWithoutWrapping']>
    ) {
      return serializer.serializeWithoutWrapping(data, resolver ?? this.containerResolver)
    },
  }
) as SerializePlainObject &
  ApiSerializer['serialize'] & { withoutWrapping: ApiSerializer['serializeWithoutWrapping'] }

HttpContext.instanceProperty('serialize', serialize)

declare module '@adonisjs/core/http' {
  export interface HttpContext {
    serialize: typeof serialize
  }
}
