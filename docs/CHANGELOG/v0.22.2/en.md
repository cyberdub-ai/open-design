---
title: Open Design 0.22.2 — More reliable update restarts
description: More reliable desktop update restarts on macOS and Windows, with accurate waiting feedback while background work closes.
---

Open Design 0.22.2 is a focused desktop update reliability patch for macOS and Windows.

## 🐛 Fixed

- 🔄 **Return to the app more reliably after an update.** The updated app waits for the previous instance to finish closing before starting, helping prevent an update restart from ending without a new window. (#7970) Thanks @PerishCode.
- ⏳ **Keep clear feedback while an update restarts.** An accepted restart no longer shows a quit failure just because closing background work takes more than ten seconds. Repeated quit requests wait for the same cleanup; an explicit quit refusal still offers a retry without reinstalling the update. (#7982) Thanks @PerishCode.

### Upgrading from an older version

The first upgrade to 0.22.2 still uses the older app's shutdown screen and behavior. If it reports a quit error but then restarts successfully, the new version can still be installed. Clients already stuck in a restart loop may need help from customer support; this patch does not automatically recover those installations.

> 📥 **Download:** [Open Design downloads](https://open-design.ai/download/).

## 🙏 Thanks to everyone who shipped 0.22.2

@PerishCode
