"""Recursive JSON type aliases used in place of ``Any`` for raw API payloads."""

from typing import TypeAlias

JSONPrimitive: TypeAlias = str | int | float | bool | None
JSONValue: TypeAlias = JSONPrimitive | list["JSONValue"] | dict[str, "JSONValue"]
JSONDict: TypeAlias = dict[str, JSONValue]
JSONList: TypeAlias = list[JSONValue]

# Narrower shape for HTTP query-string parameters (requests.Session doesn't
# accept arbitrarily-nested JSON here, only scalars and lists of scalars,
# and list elements can't themselves be None).
QueryScalar: TypeAlias = str | int | float | bool
QueryParams: TypeAlias = dict[str, QueryScalar | None | list[QueryScalar]]
