# openapi-endpoints

Generate TypeScript models and a typed endpoint map from an OpenAPI document.

`openapi-endpoints` reads an OpenAPI document and writes a single TypeScript module containing:

- **Model types**: one interface or type alias for every schema in `components.schemas`, named after the schema.
- **An `Endpoints` map**: the path parameters, query parameters, JSON request body, and JSON responses of every
  operation, keyed by path and HTTP method.
- **Helper types**: generic lookups such as `EndpointResponse<"/teams/", "get">` for building typed API clients.

The generated module contains only type declarations, so it adds nothing to your compiled application.
Schema keywords that would change the meaning of a type but are not supported raise an error that points to the
offending location, rather than silently producing incorrect types.

## Installation

Node.js 22 or newer is required.

```bash
npm install --save-dev @better-hpc/openapi-endpoints
```

## Usage

Pass the path or URL of an OpenAPI document in YAML or JSON:

```bash
npx openapi-endpoints openapi.yml --output src/api.ts
```

| Option                | Description                                                      |
|-----------------------|------------------------------------------------------------------|
| `-o, --output <file>` | Write the generated module to a file instead of standard output. |
| `--check`             | Exit with an error if the output file is missing or out of date. |
| `-h, --help`          | Show the help message.                                           |
| `-v, --version`       | Show the version number.                                         |

The command exits with status `0` on success, `1` if the document cannot be converted or `--check` fails, and `2` for
invalid arguments.

In a typical setup, the following scripts are added to `package.json`:

```json
{
  "scripts": {
    "api:generate": "openapi-endpoints openapi.yml --output src/api.ts",
    "api:check": "openapi-endpoints openapi.yml --output src/api.ts --check"
  }
}
```

## Generated output

Given a schema like the following:

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

`openapi-endpoints` generates:

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

followed by the helper types described below.

### The endpoint map

Each operation in `Endpoints` has the same five properties:

| Property    | Contents                                                                                                  |
|-------------|-----------------------------------------------------------------------------------------------------------|
| `path`      | Path parameters keyed by name, or `never` if the operation has none.                                      |
| `query`     | Query parameters keyed by name, or `never` if the operation has none. Optional unless marked as required. |
| `body`      | The JSON request body, or `never` if the operation does not accept one.                                   |
| `response`  | The union of all successful (`2xx`) response bodies, falling back to the `default` response.              |
| `responses` | Every response body keyed by status, such as `200`, `"4XX"`, or `default`.                                |

Response bodies use `void` for responses without content and `unknown` for content types other than JSON.
Path-level parameters are merged into each operation, and `$ref` values pointing to `components.parameters`,
`components.requestBodies`, and `components.responses` are resolved. Header and cookie parameters are not included.

### Helper types

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
For example, a minimal typed client built on `fetch`:

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
  let url: string = path;
  for (const [name, value] of Object.entries(options.pathParams ?? {})) {
    url = url.replace(`{${name}}`, encodeURIComponent(String(value)));
  }

  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(options.queryParams ?? {})) {
    if (value !== undefined) query.set(name, Array.isArray(value) ? value.join(",") : String(value));
  }

  const response = await fetch(`https://api.example.com${url}?${query}`);
  return await response.json();
}

// Paths, parameters, and the response type are all checked against the schema
const team = await get("/teams/{id}/", {pathParams: {id: 1}});
```

### Model names

Schemas keep their names when they are valid TypeScript identifiers.
Other names are converted to PascalCase, so `pet-status` becomes `PetStatus`.
Generation fails if two schemas convert to the same name, or if a schema uses a
reserved word or the name of a generated declaration, such as `Endpoints` or `HttpMethod`.

To use a different name in your application, add an alias in your own code:

```ts
export type { RestrictedUser as User } from "./api";
```

## Supported schema features

| Schema feature                                           | TypeScript output                                   |
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

Default values do not make properties required.
Annotation and validation keywords such as `description`, `format`, `pattern`, `maxLength`, 
`readOnly`, and `example` do not change the generated type, and `description`, `format`,
`default`, and `deprecated` are copied into documentation comments.
Vendor extensions starting with `x-` are ignored.

## Development

Development requires Node.js 22.18 or newer, which runs the TypeScript sources and tests directly without a build step.

```bash
npm install
npm test           # Run the test suite
npm run typecheck  # Type check the sources and tests
npm run build      # Compile the package into dist/
```

## License

`openapi-endpoints` is free software, released under the GNU General Public License version 3.
See [`LICENSE.md`](LICENSE) for the full license text.
