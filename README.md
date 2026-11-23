# openapi-endpoints

Generate TypeScript models and a typed endpoint map from an OpenAPI document.

`openapi-endpoints` reads an OpenAPI document and writes a single TypeScript module containing:

- **Model types**: one interface or type alias for every schema in `components.schemas`, named after the schema.
- **An `Endpoints` map**: the path parameters, query parameters, JSON request body, and JSON responses of every
  operation, keyed by path and HTTP method.
- **Helper types**: generic lookups such as `EndpointResponse<"/path/", "get">` for building typed API clients.

The generated module only contains type declarations, so it adds nothing to your compiled application.
This provides a lighter weight alternative to full API client generators ideally suited for developers
looking to implement their own API interface or minimize their footprint.

## Installation

The `openapi-endpoints` package can be installed using the standard npm commands.

```bash
npm install --save-dev @better-hpc/openapi-endpoints
```

In a typical setup, the following scripts are added to the project's `package.json`:

```json
{
  "scripts": {
    "api:generate": "openapi-endpoints openapi.yml --output src/api.ts",
    "api:check": "openapi-endpoints openapi.yml --output src/api.ts --check"
  }
}
```

## Usage

The commandline interface accepts an OpenAPI document in YAML or JSON format.
The generated TypeScript is printed to STDOUT by default, or optionally redirected to a file as demonstrated below.

```bash
npx openapi-endpoints openapi.yml --output src/api.ts
```

An existing TypeScript file can be checked for changes using the `--check` option.
This command with exit with an error if the output file is missing or out of date.

```bash
npx openapi-endpoints openapi.yml --check --output src/api.ts
```

## Generated output

The generated TypeScript module contains the following contents.

### Model Types

The generated TypeScript file includes one interface or type alias for every schema in the OpenAPI specification.
Schemas keep their names when they are valid TypeScript identifiers.
Other names are converted to PascalCase, so `pet-status` becomes `PetStatus`.
Generation fails if two schemas convert to the same name, or if a schema uses a reserved word.

Given an OpenAPI schema like the following:

```yaml
paths:
  /teams/{id}/:
    get:
      summary: Retrieve a team.
      parameters:
        - { name: id, in: path, required: true, schema: { type: integer } }
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Team' }
components:
  schemas:
    Team:
      type: object
      properties:
        id: { type: integer, readOnly: true }
        name: { type: string }
        is_active: { type: boolean, default: true }
      required: [ id, name ]
```

The `openapi-endpoints` command generates the helper types below:

```ts
export interface Team {
  id: number;
  name: string;
  /** @default true */
  is_active?: boolean;
}

export interface Endpoints {
  "/teams/{id}/": {
    /** Retrieve a team. */
    get: {
      path: {
        id: number;
      };
      query: never;
      body: never;
      response: Team;
      responses: {
        200: Team;
      };
    };
  };
}
```

OpenAPI schemas are mapped to TypeScript outputs using the following rules.

| OpenAPI schema feature                                   | TypeScript output                                   |
|----------------------------------------------------------|-----------------------------------------------------|
| `string`, `integer`, `number`, `boolean`, `null`         | `string`, `number`, `boolean`, `null`               |
| `array` with `items`                                     | `T[]`                                               |
| `object` with `properties` and `required`                | Properties are optional unless listed in `required` |
| `object` without `properties`, or `additionalProperties` | An index signature, such as `{ [key: string]: T }`  |
| `enum` and `const`                                       | Literal unions, such as `"PD" \| "AP"`              |
| `nullable: true` and `type: [..., "null"]`               | `T \| null`                                         |
| `allOf`                                                  | An intersection, or the single referenced type      |
| `oneOf` and `anyOf`                                      | A union                                             |
| `$ref` to `#/components/schemas/<name>`                  | The model type name                                 |
| Empty schemas and `true`                                 | `unknown`                                           |

Some caveats to note:

- Default OpenAPI values do **not** make properties required.
- Annotation and validation keywords (`description`, `format`, `pattern`, `maxLength`, `readOnly`, `example`)
- do not change the generated type
- The `description`, `format`,`default`, and `deprecated` annotations are copied into documentation comments.
- Vendor extensions starting with `x-` are ignored.

### Endpoints Map

The `Endpoints` map contains the path parameters, query parameters, request body, and JSON responses of every operation.
Each entry is keyed by path and HTTP method and has the same five properties:

| Property    | Contents                                                                                                  |
|-------------|-----------------------------------------------------------------------------------------------------------|
| `path`      | Path parameters keyed by name, or `never` if the operation has none.                                      |
| `query`     | Query parameters keyed by name, or `never` if the operation has none. Optional unless marked as required. |
| `body`      | The JSON request body, or `never` if the operation does not accept one.                                   |
| `response`  | The union of all successful (`2xx`) response bodies, falling back to the `default` response.              |
| `responses` | Every response body keyed by status, such as `200`, `"4XX"`, or `default`.                                |

Response bodies use `void` for responses without content and `unknown` for content types other than JSON.
Header and cookie parameters are not included.

### Helper types

Generic type lookups provide developers with flexible typing options.

| Type                              | Description                                           |
|-----------------------------------|-------------------------------------------------------|
| `HttpMethod`                      | Any HTTP method that can define an operation.         |
| `EndpointPath`                    | Any path in the endpoint map.                         |
| `EndpointMethod<P>`               | The HTTP methods defined for path `P`.                |
| `EndpointPathsWith<M>`            | The paths that define an operation for method `M`.    |
| `EndpointOperation<P, M>`         | The full operation entry for path `P` and method `M`. |
| `EndpointPathParams<P, M>`        | The `path` part of an operation.                      |
| `EndpointQueryParams<P, M>`       | The `query` part of an operation.                     |
| `EndpointRequestBody<P, M>`       | The `body` part of an operation.                      |
| `EndpointResponse<P, M>`          | The `response` part of an operation.                  |
| `EndpointStatusResponse<P, M, S>` | The response body for status `S`, such as `422`.      |

Every lookup resolves to `never` when the method is not defined for the path.
Because they accept any `HttpMethod`, the helpers work in generic function signatures.
For example, a minimal typed client might look like:

```ts
import type { EndpointPathParams, EndpointPathsWith, EndpointQueryParams, EndpointResponse } from "./api";

/** Options for a GET request to an API endpoint. */
interface GetOptions<P extends EndpointPathsWith<"get">> {
  pathParams?: EndpointPathParams<P, "get">;
  queryParams?: EndpointQueryParams<P, "get">;
}

/** Send a GET request and return the parsed JSON response. */
async function get<P extends EndpointPathsWith<"get">>(
  path: P,
  options: GetOptions<P> = {},
): Promise<EndpointResponse<P, "get">> {
  // HTTP logic goes here
}

// Paths, parameters, and the response type are all checked against the schema
const team = await get("/teams/{id}/", {pathParams: {id: 1}});
```

## License

`openapi-endpoints` is free software, released under the GNU General Public License version 3.
See the [license](LICENSE.md) for the full license text.
