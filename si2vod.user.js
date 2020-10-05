// ==UserScript==
// @name         Sentry issue to VersionOne defect converter
// @homepage     https://github.com/deftbrain/sentry-issue-to-versionone-defect-converter
// @version      1.0
// @description  A userscript that provides fast creation of a VersionOne defect from a Sentry issue.
// @author       https://github.com/deftbrain, https://github.com/jackxavier
// @include      *://*sentry*.*
// @require      https://openuserjs.org/src/libs/sizzle/GM_config.min.js
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// ==/UserScript==

(function() {
    'use strict';

    const SENTRY_API_BASE_URL = `${window.location.protocol}//${window.location.hostname}/api/0`;
    const SENTRY_API_ISSUES_ENDPOINT = `${SENTRY_API_BASE_URL}/issues`;
    const V1_BULK_API_PATH = '/api/asset'
    const V1_ASSET_DETAILS_PATH = '/assetdetail.v1'
    const V1_ASSET_NAME_ID_DELIMITER = ` |@| `;
    const CONFIG_ID = 'main';
    const CONFIG_FIELD_V1_BASE_URL = 'v1BaseUrl';
    const CONFIG_FIELDS = {
        [CONFIG_FIELD_V1_BASE_URL]: {
            label: 'V1 Base URL',
            title: 'Example: https://www1.domain.com/InstanceName',
            type: 'text',
            size: 50,
        },
        backlogGroup: {
            label: 'Backlog group',
            isV1Asset: true,
        },
        environment: {
            label: 'Environment',
            isV1Asset: true,
        },
        epic: {
            label: 'Epic',
            isV1Asset: true,
        },
        priority: {
            label: 'Priority',
            isV1Asset: true,
        },
        project: {
            label: 'Project',
            isV1Asset: true,
        },
        source: {
            label: 'Source',
            isV1Asset: true,
        },
        status: {
            label: 'Status',
            isV1Asset: true,
        },
        team: {
            label: 'Team',
            isV1Asset: true,
        },
        nameTemplate: {
            label: 'Name template',
            title: 'Available placeholders: {{metadata.type}}, {{metadata.value}}',
            type: 'text',
            size: 75,
            default: '[Sentry] {{metadata.value}}'
        },
        maxNameLength: {
            label: 'Name length limit',
            type: 'unsignedint',
            size: 3,
            default: 110,
        },
        descriptionTemplate: {
            label: 'Description template',
            title: 'Available placeholders: {{permalink}}',
            type: 'textarea',
            cols: 100,
            rows: 7,
            default:
                `<h1>Acceptance criteria</h1>
<ol>
    <li>The <a href="{{permalink}}" target="_blank">issue</a> has been fixed.</li>
</ol>`,
        },
        deploymentInstructionTemplate: {
            label: 'Deployment instruction template',
            title: 'Available placeholders: {{permalink}}',
            type: 'textarea',
            cols: 100,
            rows: 7,
            default:
                `<ol>
    <li>Release code changes</li>
    <li>Resolve the <a href="{{permalink}}" target="_blank">issue</a></li>
</ol>`,
        },
    };

    setupMenu();

    function setupMenu() {
        GM_registerMenuCommand('Preferences...', openPreferences);
        GM_registerMenuCommand('Convert', convertIssueToDefect);
    }

    function openPreferences() {
        return prepareConfig().then(config => {
            GM_config.init(config);
            GM_config.open();
        });
    }

    function convertIssueToDefect() {
        for (let field in CONFIG_FIELDS) {
            if (!getRawConfigValue(field)) {
                alert('Required fields are not set in the preferences of the userscript!');
                return;
            }
        }

        const issueId = getSentryIssueId();
        if (!issueId) {
            alert('A VersionOne defect can be created from an issue details page only!');
            return;
        }
        getSentryIssue(issueId)
            .catch(error => {
                alert(`Unable to get issue details from Sentry: ${error.message}`);
                throw error;
            })
            .then(issue => createDefectFromIssue(issue)
                .catch(error => {
                    alert(`Unable to create a defect: ${error.message}`);
                    throw error;
                })
                .then(defectId => {
                    const defectDetailsUrl = `${getV1BaseUrl()}${V1_ASSET_DETAILS_PATH}?oid=${defectId}`;
                    Promise.allSettled([
                        addDefectUrlToIssue(defectDetailsUrl, issue.id)
                            .catch(error => {
                                alert(`Unable to add a defect URL to the issue: ${error.message}`);
                                throw error;
                            }),
                        getSentryUserId()
                            .catch(error => {
                                alert(`Unable to get user ID from Sentry: ${error.message}`);
                                throw error;
                            })
                            .then(userId => setOwnerToIssue(userId, issue.id)
                                .catch(error => {
                                    alert(`Unable to set owner to the issue: ${error.message}`);
                                    throw error;
                                })
                            )
                    ]).then(() => {
                        GM_openInTab(defectDetailsUrl, {
                            active: true,
                            insert: true,
                            setParent: true,
                        });
                        window.location.reload();
                    });
                })
            );
    }

    function prepareConfig() {
        return getFields().then(fields => {
            return {
                id: CONFIG_ID,
                title: 'Preferences',
                fields: fields,
                events: {
                    open: function(doc) {
                        // Hide 'Reset to defaults' link because it
                        // doesn't work well out from the box in our case
                        doc.getElementById(CONFIG_ID + '_resetLink').remove();
                    },
                    init: function() {
                        for (let field in CONFIG_FIELDS) {
                            if (GM_config.fields[field] && getRawConfigValue(field)) {
                                GM_config.fields[field].value = getRawConfigValue(field);
                            }
                        }
                    },
                    save: function(values) {
                        const shouldReinitializeConfig = getV1BaseUrl() != values[CONFIG_FIELD_V1_BASE_URL];
                        for (let field in values) {
                            GM_config.setValue(field, values[field]);
                        }
                        if (shouldReinitializeConfig) {
                            GM_config.close();
                            openPreferences();
                        }
                    },
                }
            };
        });
    }

    async function getFields() {
        const fields = {};
        const v1BaseUrl = getV1BaseUrl();
        const groupedV1Assets = v1BaseUrl ? await getGroupedV1Assets() : {};
        for (let field in CONFIG_FIELDS) {
            if (!v1BaseUrl && field !== CONFIG_FIELD_V1_BASE_URL) {
                // Hide field from the config
                fields[field] = null;
                continue;
            }

            const fieldSettings = CONFIG_FIELDS[field];
            if (fieldSettings.isV1Asset) {
                fieldSettings.type = 'select';
                fieldSettings.options = groupedV1Assets[field];
            }

            fieldSettings.save = false;
            fields[field] = fieldSettings;
        }

        return fields;
    }

    function getGroupedV1Assets() {
        return requestJson(
            getV1BaseUrl() + V1_BULK_API_PATH,
            {
                method: 'POST',
                data: JSON.stringify([
                    {from: 'Scope', select: ['Name'], where: {AssetState: '64'}, sort: ['Parent.ID', 'Order']},
                    {from: 'Theme', select: ['Name'], where: {AssetState: '64'}, sort: ['Scope.ID', 'Order']},
                    {from: 'Custom_Environment', select: ['Name'], where: {AssetState: '64'}, sort: ['Order']},
                    {from: 'WorkitemPriority', select: ['Name'], where: {AssetState: '64'}, sort: ['Order']},
                    {from: 'StorySource', select: ['Name'], where: {AssetState: '64'}, sort: ['Order']},
                    {from: 'StoryStatus', select: ['Name'], where: {AssetState: '64'}, sort: ['Order']},
                    {from: 'Team', select: ['Name'], where: {AssetState: '64'}, sort: ['Name']},
                    {from: 'Epic', select: ['Name'], where: {AssetState: '64'}, sort: ['Name']},
                ]),
            }
        ).catch(error => {
            alert(`Unable to fetch available values for defect properties from VersionOne.`);
            throw error;
        }).then(response => {
            const result = {};
            [
                result.project,
                result.backlogGroup,
                result.environment,
                result.priority,
                result.source,
                result.status,
                result.team,
                result.epic,
            ] = response.queryResult.results.map(
                assets => assets.map(asset => `${asset.Name}${V1_ASSET_NAME_ID_DELIMITER}${asset._oid}`)
            );
            return result;
        });
    }

    function getSentryIssueId() {
        const pathComponents = window.location.pathname.split('/');
        const isIssueDetailsPage = pathComponents.length >= 5
            && 'issues' === pathComponents[3]
            && Number.isInteger(Number(pathComponents[4]))
            && Number(pathComponents[4]) > 0;
        return isIssueDetailsPage ? pathComponents[4] : undefined;
    }

    function getSentryIssue(id) {
        return requestJson(`${SENTRY_API_ISSUES_ENDPOINT}/${id}/`);
    }

    function getSentryUserId() {
        return requestJson(SENTRY_API_BASE_URL + '/')
            .then(data => data.user.id);
    }

    function getSentryCsrfToken() {
        return getCookie('sc');
    }

    function setOwnerToIssue(userId, issueId) {
        return requestJson(
            `${SENTRY_API_ISSUES_ENDPOINT}/${issueId}/`,
            {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getSentryCsrfToken(),
                },
                data: JSON.stringify({assignedTo: userId}),
            }
        );
    }

    function addDefectUrlToIssue(defectDetailsUrl, issueId) {
        return requestJson(
            `${SENTRY_API_ISSUES_ENDPOINT}/${issueId}/comments/`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getSentryCsrfToken(),
                },
                data: JSON.stringify({text: `[The related defect in VersionOne](${defectDetailsUrl})`}),
            }
        );
    }

    function getV1BaseUrl() {
        return getConfigValue(CONFIG_FIELD_V1_BASE_URL);
    }

    function getConfigValue(field) {
        const value = getRawConfigValue(field);
        if (value && CONFIG_FIELDS[field].isV1Asset) {
            return value.split(V1_ASSET_NAME_ID_DELIMITER)[1];
        }

        return value;
    }

    function getRawConfigValue(field) {
        return GM_config.getValue(field) || null;
    }

    function createDefectFromIssue(issue) {
        const maxNameLength = getConfigValue('maxNameLength');
        let name = getConfigValue('nameTemplate')
            .replace('{{metadata.type}}', issue.metadata.type)
            .replace('{{metadata.value}}', issue.metadata.value);
        if (name.length > maxNameLength) {
            name = name.substring(0, maxNameLength) + '...';
        }
        const data = JSON.stringify({
            AssetType: 'Defect',
            Custom_DeploymentInstructions: getConfigValue('deploymentInstructionTemplate')
                .replace('{{permalink}}', issue.permalink),
            Custom_Environment: getConfigValue('environment'),
            Description: getConfigValue('descriptionTemplate')
                .replace('{{permalink}}', issue.permalink),
            Name: name,
            Owners: {from: 'Member', where: {IsSelf: true}},
            Parent: getConfigValue('backlogGroup'),
            Priority: getConfigValue('priority'),
            Scope: getConfigValue('project'),
            Source: getConfigValue('source'),
            Status: getConfigValue('status'),
            Super: getConfigValue('epic'),
            Team: getConfigValue('team'),
        });
        return requestJson(
            getV1BaseUrl() + V1_BULK_API_PATH,
            {
                method: 'POST',
                data: data,
            }
        ).then(response => {
            if (response.commandFailures.count) {
                throw new Error(response.commandFailures.commands[0].error.message);
            }

            return response.assetsCreated.oidTokens[0];
        });
    }

    function requestJson(url, options = {}) {
        return new Promise((resolve, reject) => {
            options.onerror = options.ontimeout = reject;
            options.onload = resolve;
            options.headers = {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                ...(options.headers || {})
            }
            GM_xmlhttpRequest({
                method: 'GET',
                timeout: 5000,
                ...options,
                url,
            });
        }).then(response => {
            if ([200, 201].indexOf(response.status) !== -1) {
                return JSON.parse(response.responseText);
            }
            throw new Error(response.statusText);
        });
    }

    function getCookie(name) {
        const matches = document.cookie.match(new RegExp(
            `(?:^|; )${name.replace(/([\.$?*|{}\(\)\[\]\\\/\+^])/g, '\\$1')}=([^;]*)`
        ));
        return matches ? decodeURIComponent(matches[1]) : undefined;
    }
})();
