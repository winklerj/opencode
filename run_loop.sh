#!/bin/bash

while true; do
  cat PROMPT.md | claude --dangerously-skip-permissions --output-format stream-json >> output.jsonl
  sleep 10
done
