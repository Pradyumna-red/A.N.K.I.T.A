# Third-party notices

## Chat On Steroids

The focused ChatGPT browser readers and native composer delivery adapt MIT-licensed
software from Chat On Steroids. The full license and source pin are distributed in
`vendor/chat-on-steroids/LICENSE` and `vendor/chat-on-steroids/source.json`. ANKITA
does not depend on a running CoS app or its saved credentials.

## OpenAI Secure MCP Tunnel client

Windows x64 packages include the official OpenAI tunnel client and its forwarding
helper, pinned by `vendor/openai-tunnel/source.json`. The tunnel client is licensed
under Apache-2.0. Its complete publisher LICENSE, NOTICE, third-party license list,
forwarder manifest and SPDX inventory are included beside the binaries in
`resources/native-tunnel/win32-x64`. Publisher helper bytes are kept intact during
ANKITA code signing. Independent vulnerability scanning was unavailable during
this integration's preparation; matching checksums establish provenance only.

ANKITA's companion includes software adapted from Coucou's Windows animation,
mascot engine, layout and view helpers. The MIT software license applies to
those adaptations. Coucou's separate artwork and audio license is not included:
ANKITA uses its own character drawing and synthesized audio, and does not bundle
Coucou's mascot artwork, WAV recordings or brand assets.

## Coucou

MIT License

Copyright (c) 2026 Louis Raillé

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
