#!/bin/bash
# Test hook for pre-tool-use
echo "PRE_TOOL_USE: $HOOK_TOOL_NAME"
echo "Context: $HOOK_CONTEXT"

# Check if we should continue
if [ "$HOOK_TOOL_NAME" = "dangerous-tool" ]; then
    echo "HOOK_RESULT: stop"
    echo "HOOK_REASON: Dangerous tool blocked by hook"
    exit 1
else
    echo "HOOK_RESULT: continue"
    exit 0
fi