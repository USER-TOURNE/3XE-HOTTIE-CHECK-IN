#!/bin/sh
# Cache-bust: tag script URLs with a hash of their contents so phones fetch fresh copies.
# Run after editing analytics.js or rebuilding payload.js.
cd "$(dirname "$0")/.." || exit 1
V=$(cat analytics.js payload.js | sha1sum | cut -c1-8)
sed -i -E "s#src=\"payload.js(\?v=[^\"]*)?\"#src=\"payload.js?v=$V\"#; s#src=\"analytics.js(\?v=[^\"]*)?\"#src=\"analytics.js?v=$V\"#" index.html
echo "stamped v=$V"
