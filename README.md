# main-branch-check action

[![Build](https://github.com/openai/main-branch-check-action/actions/workflows/build.yaml/badge.svg?branch=main)](https://github.com/openai/main-branch-check-action/actions/workflows/build.yaml)

This check will determine the workflow it was called from, then
see if the workflow has run on master, and if it has, ensure
it is passing.

To bypass this (e.g. if your PR is the fix), you can add:
```
[ci override_main_branch_checks $WORKFLOW]'
```

Or you to set all checks to non-fatal, you can do:

```
[ci override_main_branch_checks]
```

to your PR description.

## Using

To use this, add a step into your workflow like:

```yaml
- name: Main Branch Check
  # Do the check even if the PR failed elsewhere,
  # but don't do it if we're on <your main branch>
  if: always() && github.ref != 'refs/heads/main'
  uses: ./.github/actions/main-branch-check
  permissions:

  with:
    gh_token: ${{ secrets.SOME_TOKEN }}
    main_branch: "master"
    workflow_ref: ${{ github.workflow_ref }}
```

You will need a token that has the 'workflow' scope,
and read/write access to pull-requests.

## Updating

If you update the code, run:

```bash
make
```

to build the self-contained bundle.

If you update dependencies you'll need to run `npm install` first
