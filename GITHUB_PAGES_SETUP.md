# GitHub Pages Setup Instructions

Since the GITHUB_TOKEN permissions are greyed out in your repository settings, this indicates your repository is part of an organization that has restricted these permissions at the organization level. Here are the steps to resolve this:

## Option 1: Organization Admin Fix (Recommended)

If you have admin access to the `structured-world` organization:

1. **Go to Organization Settings:**
   - Navigate to `https://github.com/organizations/structured-world/settings/actions`

2. **Configure Workflow Permissions:**
   - Scroll down to "Workflow permissions"
   - Select **"Read and write permissions"**
   - Check **"Allow GitHub Actions to create and approve pull requests"**
   - Click **"Save"**

3. **Enable GitHub Pages in Repository:**
   - Go to `https://github.com/structured-world/project-nexus-mcp/settings/pages`
   - Set **Source** to **"GitHub Actions"**
   - Click **"Save"**

## Option 2: Alternative Approach (If you can't change org settings)

If you don't have organization admin access, you have a few options:

### 2a. Request Organization Admin to Update Settings
Ask the organization admin to follow Option 1 above.

### 2b. Use Personal Access Token (Advanced)
Create a Personal Access Token with appropriate permissions:

1. **Create PAT:**
   - Go to `https://github.com/settings/tokens`
   - Click "Generate new token (classic)"
   - Select scopes: `repo`, `write:packages`, `workflow`
   - Generate and copy the token

2. **Add as Repository Secret:**
   - Go to `https://github.com/structured-world/project-nexus-mcp/settings/secrets/actions`
   - Click "New repository secret"
   - Name: `COVERAGE_TOKEN`
   - Value: Your PAT token

3. **Update Workflow (if using PAT):**
   Replace `github-token: ${{ secrets.GITHUB_TOKEN }}` with `github-token: ${{ secrets.COVERAGE_TOKEN }}`

## Verification Steps

After completing the setup:

1. **Check GitHub Pages is enabled:**
   - Go to repository Settings → Pages
   - Source should be "GitHub Actions"

2. **Trigger workflow:**
   - Make a small change to any file in `src/`
   - Push to main branch
   - Check Actions tab for workflow run

3. **Verify deployment:**
   - Wait for workflow completion
   - Visit `https://structured-world.github.io/project-nexus-mcp/coverage/`

## Current Workflow Features

The coverage workflow includes:

✅ **Automatic deployment** on main branch pushes  
✅ **PR comments** with coverage summaries (if permissions allow)  
✅ **Coverage badges** in README  
✅ **Interactive HTML reports** with drill-down capability  
✅ **Error handling** for permission issues  
✅ **Artifact uploads** for manual review  

## Troubleshooting

### If GitHub Pages URL shows 404:
- Check that GitHub Pages is enabled with "GitHub Actions" source
- Verify the workflow completed successfully
- Wait a few minutes after deployment

### If PR comments don't work:
- This is expected if organization permissions are restricted
- Coverage reports will still be generated and deployed
- You can manually check artifacts in the Actions tab

### If workflow fails:
- Check the Actions tab for error details
- Verify all required permissions are granted
- Check if branch protection rules are interfering

## Manual Testing

To test locally before pushing:

```bash
# Run coverage
yarn test:cov

# Check generated files
ls -la coverage/
open coverage/lcov-report/index.html
```

## Next Steps

1. Complete the GitHub Pages setup using Option 1 or 2a above
2. Push a change to trigger the workflow
3. Verify the live coverage report is accessible
4. Check that the coverage badge in README links correctly

The workflow is designed to be resilient and will work even with limited permissions - you'll just miss out on the PR commenting feature if organization permissions are restrictive.