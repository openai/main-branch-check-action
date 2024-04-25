// load modules
const core = require('@actions/core')
const github = require('@actions/github')

// inputs
const token = core.getInput('gh_token')
// oddly this is not in github.context :/ only the
// name is, and the name doesn't even have to be unique.
const workflowRef = core.getInput('workflow_ref')
const mainBranch = core.getInput('main_branch')
const allowOverrideAll = core.getInput('allow_override_all')

// contexts
const octokit = github.getOctokit(token)
const context = github.context

// static constants
const overrideFlag = 'override_main_branch_checks'
const uniqueIdentifier = '<!-- unique_identifier: action_comment_marker -->'

// stuff from contextx
const workflowName = context.workflow
const { owner, repo } = context.repo
const prNumber = context.payload.pull_request.number

// other consts
const commentHeader = "**Workflow Status Tracker**"
const commentIntro = (
    `The following workflows are failing on ${mainBranch}. ` +
    "You can make specific workflows not fail by adding " +
    `\`[ci ${overrideFlag} \$workflow]\`  to your PR description ` +
    `or bypass _all_ by adding \`[ci ${overrideFlag}]\`.`
)
const commentTailer = (
    "This comment created by the main-branch-check action. " +
    "It will be removed when no workflows are red on the " +
    `${mainBranch} branch.`
)

async function updateStatusComment(overridden, workflowStatus, workflowUrl) {
    const level = overridden ? 'warning' : 'failure'
    const { data: comments } = await octokit.rest.issues.listComments({
        owner,
        repo,
        issue_number: prNumber,
    })

    let statusComment = comments.find(comment => comment.body.includes(uniqueIdentifier))

    if (!statusComment && workflowStatus === "success") {
        console.log("No existing comment found, and job was successful, nothing to do")
        return
    }

    let commentBody = ""
    let lines = []
    if (statusComment) {
        [commentBody, _] = statusComment.body.split(uniqueIdentifier)
        lines = commentBody.trim().split(/\n+/)
    } else {
        lines = [commentHeader, commentIntro]
    }
    const workflowNameLink = `[${workflowName}](${workflowUrl})`
    const workflowMarkerPattern = `- ${workflowNameLink}: `
    const workflowLine = `${workflowMarkerPattern}${level}`
    const workflowMatch = `[${workflowName}]`
    const workflowIndex = lines.findIndex(line => line.includes(workflowMatch))

    if (workflowStatus === "failure") {
        if (workflowIndex !== -1) {
            // update existing workflow line with new level
            console.log("Updating workflow in comment")
            lines[workflowIndex] = workflowLine
        } else {
            console.log("Adding new workflow to comment")
            lines.push(workflowLine)
        }
    } else {
        // If workflow succeeded remove from list
        if (workflowIndex !== -1) {
            console.log("Removing successful workflow from comment")
            lines.splice(workflowIndex, 1)
        }
    }

    // construct final comment
    // Header should have additional newline
    lines[0] += "\n"
    // Intro too
    lines[1] += "\n"
    commentBody = lines.join('\n').trim() + `\n\n${uniqueIdentifier}\n${commentTailer}\n`

    // Update or remove the comment as necessary
    if (!statusComment) {
        console.log("Creating comment")
        await octokit.rest.issues.createComment({
            owner,
            repo,
            issue_number: prNumber,
            body: commentBody,
        })
    } else if (!commentBody.match(/^- .+/gm)) {
        console.log("Removing comment, last workflow passing or no workflows listed")
        await octokit.rest.issues.deleteComment({
            owner,
            repo,
            comment_id: statusComment.id,
        })
    } else {
        console.log("Updating comment with modified workflow list")
        // Update the comment with the new body
        await octokit.rest.issues.updateComment({
            owner,
            repo,
            comment_id: statusComment.id,
            body: commentBody,
        })
    }
}

async function getOverrideFlags() {
    console.log("Gathering PR description...")
    // Fetch PR description
    const { data: pr } = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
    })
    let flags = []
    const prDesc = pr.body
    if (prDesc !== null) {
        const matcher = `\\[ci ${overrideFlag} ?(.*)\\]`
        const re = new RegExp(matcher, 'gi')
        const results = [...prDesc.matchAll(re)]
        for (const result of results) {
            if (result[1] === "") {
                if (allowOverrideAll) {
                    flags = flags.concat(["all"])
                } else {
                    console.log("Override flag was set for all workflows, but action configured to not allow that. Please specify workflows to override.")
                }
            } else {
                flags = flags.concat([result[1]])
            }
        }
    }
    return flags
}

async function isWorkflowOverridden(flags) {
    return (flags.includes("all") || flags.includes(workflowName))
}

async function run() {
    console.log("Running action")
    try {
        console.log("Checking this is a pull request")
        // Ensure this action is triggered within a PR context
        if (!context.payload.pull_request) {
            core.setFailed('This action must be triggered by a pull request')
            return
        }

        console.log(`owner: ${owner}, repo: ${repo}, pr: ${prNumber}`)


        console.log("Gathering workflow data...")
        // Get the current workflow run's ID and use it to fetch its details
        const start = workflowRef.indexOf("workflows/") + "workflows/".length
        const end = workflowRef.indexOf("@")
        const workflowPath = workflowRef.substring(start, end)

        console.log(`Gathering workflow runs for ${workflowPath}...`)
        const { data: runs } = await octokit.rest.actions.listWorkflowRuns({
            owner,
            repo,
            workflow_id: workflowPath,
            branch: mainBranch,
            status: 'completed',
        })

        const sortedRuns = runs.workflow_runs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        const latestRun = sortedRuns[0]
        const flags = await getOverrideFlags()
        const overridden = await isWorkflowOverridden(flags)

        console.log("Creating, updating, or removing comment, as necessary")
        await updateStatusComment(overridden, latestRun.conclusion, latestRun?.html_url)
        if (latestRun && latestRun.conclusion !== 'success') {
            let msg = `Latest run of workflow on master branch is failing: ${latestRun?.html_url}`
            if (overridden) {
                console.log(msg)
                console.log("Override flag found, not failing the run.")
            } else {
                core.setFailed(msg)
            }
        } else {
            console.log(`Latest run of workflow on master branch is successful: ${latestRun?.html_url}`)
        }
    } catch (error) {
        core.setFailed(`Action failed with error: ${error}`)
    }
}

run()
