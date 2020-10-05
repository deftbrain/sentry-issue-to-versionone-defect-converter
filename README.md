# Sentry issue to VersionOne defect converter
A [userscript](https://openuserjs.org/about/Userscript-Beginners-HOWTO) that provides fast creation of a [VersionOne](https://www.collab.net/products/versionone) defect from a [Sentry](https://sentry.io) issue.  
Just a few clicks and it will do the following:
* create a defect for an issue and open it in a new tab
* add the URL of the created defect to issue comments
* assign the issue to you

## Requirements
* Chrome 76+ / Firefox 71+ / Safari 13+ / Edge 79+
* [Tampermonkey](http://www.tampermonkey.net/) browser extension
* VersionOne 18.0+
* Sentry (by default the script is enabled on domains that contain `sentry` substring,
 but you can change the criteria via script settings)
* You have to be authorized in your Sentry and VersionOne instances to let the script send authorized requests on your behalf

## Installation
1. Open the [userscript](https://github.com/deftbrain/sentry-issue-to-versionone-defect-converter/raw/main/si2vod.user.js) in the browser. _Tampermonkey will pick up the file automatically and ask you to install it._
1. Click the `Install` button.
1. Open Sentry.
1. Staying in the same tab, click the Tampermonkey extension icon
 -> `Sentry issue to VersionOne defect converter` -> `Preferences...`
1. Set the `V1 Base URL` (format: https://www1.domain.com/InstanceName).
1. Click the `Save` button. _You will be asked about allowing the script to send
 cross-origin request to the specified VersionOne instance. Click `Always allow`.
 New fields for setting defect properties will appear in the `Preferences` after that action._
1. Set needed values to the new fields.
1. Click the `Save` and `Close` buttons.

## Usage
1. Open an issue details page in Sentry.
1. Staying in the same tab, click the Tampermonkey extension icon
 -> `Sentry issue to VersionOne defect converter` -> `Convert`.
