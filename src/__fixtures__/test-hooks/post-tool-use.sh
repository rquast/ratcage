#!/bin/bash
# Test hook for post-tool-use
echo "POST_TOOL_USE: $HOOK_TOOL_NAME"
echo "Result: $HOOK_TOOL_RESULT" 
echo "Duration: ${HOOK_DURATION_MS}ms"

# Log the result
echo "$(date): Tool $HOOK_TOOL_NAME completed with result $HOOK_TOOL_RESULT" >> /tmp/ratcage-hook.log

echo "HOOK_RESULT: continue"
exit 0