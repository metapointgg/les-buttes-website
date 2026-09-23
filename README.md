# Les Buttes Holiday Cottages

A fast, responsive website for Les Buttes Holiday Cottages in St Pierre du Bois, Guernsey. Built with Astro, edited through Pages CMS and ready for low-cost AWS hosting.

## Included

- Home, cottage index, Geranium, Honeysuckle, Marigold, Explore Guernsey, About, Find Us, Contact and Privacy pages.
- Supplied cottage photography, generated in responsive AVIF and WebP formats.
- Direct Airbnb availability links and selected short guest-review excerpts.
- Mobile-first layout, accessible navigation, semantic headings and reduced-motion support.
- Canonical URLs, social metadata, sitemap, robots file and structured data.
- Lightweight Pages CMS configuration for changing copy and adding images.
- Terraform for private S3, CloudFront OAC, HTTPS, Route 53, a budget alert and GitHub OIDC deployment.
- GitHub Actions deployment from `main` without long-lived AWS access keys.

## Run locally

Requires Node.js 20.11 or newer.

```bash
npm install
npm run dev
```

For a complete production check:

```bash
npm test
npm run preview
```

## Edit with Pages CMS

1. Visit [Pages CMS](https://app.pagescms.org) and sign in with GitHub.
2. Install its GitHub App for `metapointgg/les-buttes-website`.
3. Open the repository. The editor is defined by `.pages.yml`.
4. Edit a general page, cottage or site setting and save.

Pages CMS commits edits to GitHub; the deployment workflow rebuilds the site automatically. Cottage gallery fields allow images to be uploaded, described and reordered. Astro optimises each image at build time.

Only use short excerpts from genuine Airbnb reviews and retain the listing review URL. Do not add changing review totals or star averages unless they will be actively maintained.

## AWS deployment

Copy `infra/terraform.tfvars.example` to `infra/terraform.tfvars`, enter the real Route 53 hosted-zone ID and then run:

```bash
cd infra
terraform init
terraform plan
terraform apply
```

If DNS is hosted elsewhere, supply `existing_certificate_arn` for a validated ACM certificate in `us-east-1` and leave `hosted_zone_id` unset. Preserve all existing MX, SPF, DKIM and DMARC records during any DNS move.

Set these GitHub Actions repository variables from the Terraform outputs:

| Variable | Value |
| --- | --- |
| `AWS_ROLE_ARN` | `github_deploy_role_arn` |
| `AWS_REGION` | `eu-west-2` |
| `S3_BUCKET` | `site_bucket` |
| `CLOUDFRONT_DISTRIBUTION_ID` | `cloudfront_distribution_id` |

If the AWS account already has the GitHub OIDC provider, import it into Terraform state before applying.

## Important content details

- Geranium sleeps four and has two bedrooms, three beds and two bathrooms.
- Honeysuckle sleeps six and has three bedrooms, five beds and **two bathrooms**.
- Marigold is presented as currently unavailable pending future refurbishment.
- Bookings and payments are handled only through Airbnb.
