/**
 * Validation helper functions for OpenAPI validation
 */
import { type OpenAPIV3 } from "openapi-types";
import AjvLib from "ajv";
const Ajv = AjvLib.default || AjvLib;

/**
 * Validate request parameters against OpenAPI specification
 */
export function validateRequestParameters(
  url: string,
  openApiDoc: OpenAPIV3.Document,
  method: string,
  input: {
    urlVariables?: Record<string, unknown>;
    urlQueryParams?: Record<string, unknown>;
    headers?: Record<string, string>;
    requestBody?: Record<string, unknown>;
  },
): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  // validate path
  const {pathValidateRes, apiPath, specPath, specPathItem} = validatePath(openApiDoc, url);
  if (!pathValidateRes || !specPathItem) {
    errors.push(`API path ${apiPath} is not valid or not found in OpenAPI specification`);
    return { isValid: false, errors };
  }

  // Check if the method exists for the path
  const operation = specPathItem[method.toLowerCase() as keyof typeof specPathItem] as OpenAPIV3.OperationObject;
  if (!operation) {
    errors.push(`Method ${method} not found for path ${specPath} in OpenAPI specification`);
    return { isValid: false, errors };
  }

  // Initialize AJV for schema validation
  const _ajv = new Ajv({ allErrors: true });

  validateUrlPathParam(input.urlVariables, operation.parameters, errors);

  validateUrlQueryParam(input.urlQueryParams, operation.parameters, errors);

  validateUrlHeaders(input.headers, operation.parameters, errors);

  validateUrlRequestBody(input.requestBody, operation.requestBody, errors);

  return { isValid: errors.length === 0, errors };
}

/**
 *  Validate the API path against the OpenAPI document
 */
export function validatePath(openApiDoc: OpenAPIV3.Document, inputUrl: string): {
  pathValidateRes : boolean,
  apiPath : string,
  specPath : string,
  specPathItem?: OpenAPIV3.PathItemObject
} {
  // Extract the path from the URL (remove base URL part)
  const apiPath : string = parseApiPathFromUrl(inputUrl);
  if (!apiPath) {
    console.error(`input url ${inputUrl} is not valid, please check it.`);
    return {pathValidateRes : false, apiPath:"", specPath: "", specPathItem: undefined};
  }
  // bathPath validation
  const serverObj = openApiDoc.servers?.[0] || { url: "" };
  let basePath : string = "";
  if (serverObj?.variables) {
    for (const [key, value] of Object.entries(serverObj.variables)) {
      if (key === "basePath") {
        basePath = value.default;
      }
    }
  }
  const basePathRegex = new RegExp(`${basePath.replace(/\{[^}]+\}/g, "[^/]+")  }$`);
  if (basePath && !basePathRegex.test(apiPath)) {
    console.error(`API path ${apiPath} does not match the base path ${basePath} in OpenAPI specification.`);
    return {pathValidateRes : false, apiPath, specPath: "", specPathItem: undefined};
  }

  // specPath validation
  for (const specPath of Object.keys(openApiDoc.paths || {})) {
    const specPathRegex = new RegExp(`${specPath.replace(/\{[^}]+\}/g, "[^/]+")  }$`);
    if (specPathRegex.test(apiPath) && openApiDoc.paths?.[specPath]) {
      const specPathItem = openApiDoc.paths[specPath];
      return { pathValidateRes: true, apiPath, specPath, specPathItem};
    }
  }

  return {pathValidateRes : false, apiPath, specPath: "", specPathItem: undefined};
}

/**
 *  parse path from the given url by llm
 */
export function parseApiPathFromUrl(inputUrl: string): string {
  try {
    const urlObj = new URL(inputUrl);
    return decodeURIComponent(urlObj.pathname); // Decode URL path
  } catch (urlError) {
    // If URL parsing fails, try to extract path manually
    const pathMatch = inputUrl.match(/https?:\/\/[^/]+(.*)$/);
    if (pathMatch) {
      return pathMatch[1];
    }
    console.error(`Failed to parse API path from URL: ${inputUrl}`);
    return  "";
  }
}

/**
 *  Validate URL path parameters against OpenAPI specification
 */
export function validateUrlPathParam(
  urlVariables: Record<string, unknown> | undefined,
  parameters: (OpenAPIV3.ReferenceObject | OpenAPIV3.ParameterObject)[] | undefined,
  errors: string[],
): void {
  // Initialize AJV for schema validation
  const ajv = new Ajv({ allErrors: true });
  if (urlVariables) {
    const pathParams = (parameters || []).filter(
      (param): param is OpenAPIV3.ParameterObject =>
        !("$ref" in param) && param.in === "path",
    );

    for (const param of pathParams) {
      const value = urlVariables[param.name];

      if (param.required && (value === undefined || value === null)) {
        errors.push(`Missing required path parameter: ${param.name}`);
        continue;
      }

      if (value !== undefined && param.schema) {
        const validate = ajv.compile(param.schema);
        if (!validate(value)) {
          errors.push(`Invalid path parameter ${param.name}: ${ajv.errorsText(validate.errors)}`);
        }
      }
    }

    // Check for extra path parameters not defined in spec
    const definedPathParams = pathParams.map(p => p.name);
    const extraParams = Object.keys(urlVariables).filter(key => !definedPathParams.includes(key));
    if (extraParams.length > 0) {
      errors.push(`Unknown path parameters: ${extraParams.join(", ")}`);
    }

    // Check for required path parameters that might be missing from urlVariables
    const requiredPathParams = (parameters || [])
      .filter((param): param is OpenAPIV3.ParameterObject =>
        !("$ref" in param) && param.in === "path" && (param.required === true),
      )
      .map(param => param.name);
    const providedPathParams = Object.keys(urlVariables || {});
    const missingPathParams = requiredPathParams.filter(param => !providedPathParams.includes(param));
    if (missingPathParams.length > 0) {
      errors.push(`Missing required path parameters: ${missingPathParams.join(", ")}`);
    }
  }
}

/**
 * Validate URL query parameters against OpenAPI specification
 */
export function validateUrlQueryParam(
  urlQueryParams: Record<string, unknown> | undefined,
  parameters: (OpenAPIV3.ReferenceObject | OpenAPIV3.ParameterObject)[] | undefined,
  errors: string[],
): void {
  const ajv = new Ajv({ allErrors: true });
  if (urlQueryParams) {
    const queryParams = (parameters || []).filter(
      (param): param is OpenAPIV3.ParameterObject =>
        !("$ref" in param) && param.in === "query",
    );

    for (const param of queryParams) {
      const value = urlQueryParams[param.name];

      if (param.required && (value === undefined || value === null || value === "")) {
        errors.push(`Missing required query parameter: ${param.name}`);
        continue;
      }

      if (value !== undefined && param.schema) {
        const validate = ajv.compile(param.schema);
        // Convert string values to appropriate types for validation
        let validationValue = value;
        if (typeof value === "string" && param.schema && !("$ref" in param.schema) && (param.schema).type) {
          const schemaObj = param.schema;
          switch (schemaObj.type) {
            case "integer":
            case "number":
              validationValue = Number(value);
              break;
            case "boolean":
              validationValue = value.toLowerCase() === "true";
              break;
            case "array":
              // Handle comma-separated values for arrays
              if (param.style === "form" && !param.explode) {
                validationValue = value.split(",");
              }
              break;
          }
        }

        if (!validate(validationValue)) {
          errors.push(`Invalid query parameter ${param.name}: ${ajv.errorsText(validate.errors)}`);
        }
      }
    }
  }
}

/**
 * Validate URL headers against OpenAPI specification
 */
export function validateUrlHeaders(
  headers: Record<string, string> | undefined,
  parameters: (OpenAPIV3.ReferenceObject | OpenAPIV3.ParameterObject)[] | undefined,
  errors: string[],
): void {
  const ajv = new Ajv({ allErrors: true });
  if (headers) {
    const headerParams = (parameters || []).filter(
      (param): param is OpenAPIV3.ParameterObject =>
        !("$ref" in param) && param.in === "header",
    );

    for (const param of headerParams) {
      const headerName = param.name.toLowerCase();
      const value = headers[headerName] || headers[param.name];

      if (param.required && (value === undefined || value === null || value === "")) {
        errors.push(`Missing required header parameter: ${param.name}`);
        continue;
      }

      if (value !== undefined && param.schema) {
        const validate = ajv.compile(param.schema);
        if (!validate(value)) {
          errors.push(`Invalid header parameter ${param.name}: ${ajv.errorsText(validate.errors)}`);
        }
      }
    }
  }
}

/**
 *  Validate URL request body against OpenAPI specification
 */
export function validateUrlRequestBody(
  inputBody: Record<string, unknown> | undefined,
  operationBody: OpenAPIV3.ReferenceObject | OpenAPIV3.RequestBodyObject | undefined,
  errors: string[],
): void {
  const ajv = new Ajv({ allErrors: true, strict: false });
  if (operationBody && !("$ref" in operationBody)) {
    const requestBody = operationBody;
    const isRequired = requestBody.required || false;

    if (isRequired && (!inputBody || Object.keys(inputBody).length === 0)) {
      errors.push("Missing required request body");
    } else if (inputBody && Object.keys(inputBody).length > 0) {
      // Find the appropriate content type schema
      const contentTypes = ["application/json", "application/x-www-form-urlencoded", "multipart/form-data"];
      let schema: OpenAPIV3.SchemaObject | undefined;

      for (const contentType of contentTypes) {
        if (requestBody.content?.[contentType]?.schema) {
          schema = requestBody.content[contentType].schema as OpenAPIV3.SchemaObject;
          break;
        }
      }

      if (schema) {
        const validate = ajv.compile(schema);
        if (!validate(inputBody)) {
          errors.push(`Invalid request body: ${ajv.errorsText(validate.errors)}`);
        }
      }
    }
  }
}
