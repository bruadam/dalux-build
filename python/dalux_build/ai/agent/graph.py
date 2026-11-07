"""LangGraph server entrypoint for the Mistral RAG agent."""

from .graph_runtime import build_graph

graph = build_graph()
