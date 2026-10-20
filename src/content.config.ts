import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const translatedTextFields = {
  titleNl: z.string().optional(),
  titleFr: z.string().optional(),
  introNl: z.string().optional(),
  introFr: z.string().optional(),
  eyebrowNl: z.string().optional(),
  eyebrowFr: z.string().optional(),
  textNl: z.string().optional(),
  textFr: z.string().optional(),
  taglineNl: z.string().optional(),
  taglineFr: z.string().optional(),
  summaryNl: z.string().optional(),
  summaryFr: z.string().optional(),
  descriptionNl: z.string().optional(),
  descriptionFr: z.string().optional(),
  heroAltNl: z.string().optional(),
  heroAltFr: z.string().optional(),
  heroPrimaryLabelNl: z.string().optional(),
  heroPrimaryLabelFr: z.string().optional(),
  heroSecondaryLabelNl: z.string().optional(),
  heroSecondaryLabelFr: z.string().optional(),
  imageAltNl: z.string().optional(),
  imageAltFr: z.string().optional(),
  imageCaptionNl: z.string().optional(),
  imageCaptionFr: z.string().optional(),
  captionNl: z.string().optional(),
  captionFr: z.string().optional(),
  altNl: z.string().optional(),
  altFr: z.string().optional(),
  quoteNl: z.string().optional(),
  quoteFr: z.string().optional(),
  attributionNl: z.string().optional(),
  attributionFr: z.string().optional(),
  buttonLabelNl: z.string().optional(),
  buttonLabelFr: z.string().optional(),
  secondaryButtonLabelNl: z.string().optional(),
  secondaryButtonLabelFr: z.string().optional(),
  linkLabelNl: z.string().optional(),
  linkLabelFr: z.string().optional(),
  nameNl: z.string().optional(),
  nameFr: z.string().optional(),
  seasonNl: z.string().optional(),
  seasonFr: z.string().optional(),
  navigationLabelNl: z.string().optional(),
  navigationLabelFr: z.string().optional(),
  kickerNl: z.string().optional(),
  kickerFr: z.string().optional(),
  headingNl: z.string().optional(),
  headingFr: z.string().optional(),
  detailTextNl: z.string().optional(),
  detailTextFr: z.string().optional(),
  userDetailsNl: z.string().optional(),
  userDetailsFr: z.string().optional(),
  sourceLabelNl: z.string().optional(),
  sourceLabelFr: z.string().optional(),
  actionLabelNl: z.string().optional(),
  actionLabelFr: z.string().optional(),
  secondaryActionLabelNl: z.string().optional(),
  secondaryActionLabelFr: z.string().optional(),
  logoAltNl: z.string().optional(),
  logoAltFr: z.string().optional(),
  locationNl: z.string().optional(),
  locationFr: z.string().optional(),
  dateNl: z.string().optional(),
  dateFr: z.string().optional(),
  commentNl: z.string().optional(),
  commentFr: z.string().optional(),
  socialTitleNl: z.string().optional(),
  socialTitleFr: z.string().optional(),
  socialDescriptionNl: z.string().optional(),
  socialDescriptionFr: z.string().optional(),
};

const seo = z.object({
  ...translatedTextFields,
  title: z.string(),
  description: z.string(),
  socialTitle: z.string().optional(),
  socialDescription: z.string().optional(),
  image: z.string().optional(),
  imageAlt: z.string().optional()
});
const heroFields = {
  heroMediaType: z.enum(['image','video']).optional(),
  heroImage: z.string().optional(),
  heroAlt: z.string().optional(),
  heroPan: z.boolean().optional(),
  heroVideo: z.string().optional(),
  heroPoster: z.string().optional(),
  heroPrimaryLabel: z.string().optional(),
  heroPrimaryUrl: z.string().optional(),
  heroSecondaryLabel: z.string().optional(),
  heroSecondaryUrl: z.string().optional()
};

const reviewItem = z.object({
  ...translatedTextFields,
  stars: z.number().min(1).max(5),
  comment: z.string(),
  userDetails: z.string(),
  sourceUrl: z.string().url().optional(),
  sourceLabel: z.string().optional()
});

const sectionItem = z.object({
  ...translatedTextFields,
  kicker: z.string().optional(),
  title: z.string(),
  text: z.string().optional(),
  image: z.string().optional(),
  imageAlt: z.string().optional(),
  icon: z.enum(['arrow','bed','bath','guests','phone','mail','pin','external','menu','beach','walk','guernsey','history','heart','islands','food','kitchen','living','garden','wifi']).optional(),
  linkLabel: z.string().optional(),
  linkUrl: z.string().optional(),
  external: z.boolean().optional()
});

const detailCardItem = z.object({
  ...translatedTextFields,
  title: z.string(),
  summary: z.string(),
  detailText: z.string().optional(),
  tagline: z.string().optional(),
  image: z.string().optional(),
  imageUrl: z.string().url().optional(),
  imageAlt: z.string().optional(),
  logo: z.string().optional(),
  logoUrl: z.string().url().optional(),
  logoAlt: z.string().optional(),
  detailSections: z.array(z.object({
  ...translatedTextFields,
    heading: z.string(),
    text: z.string(),
    icon: z.enum(['guests','history','heart','garden','pin']).optional()
  })).optional(),
  date: z.string().optional(),
  location: z.string().optional(),
  actionLabel: z.string().optional(),
  actionUrl: z.string().optional(),
  actionExternal: z.boolean().optional(),
  secondaryActionLabel: z.string().optional(),
  secondaryActionUrl: z.string().optional(),
  secondaryActionExternal: z.boolean().optional()
});


const pageSection = z.object({
  ...translatedTextFields,
  enabled: z.boolean().optional(),
  type: z.enum(['text','feature','image','cards','iconCards','featureStrip','list','gallery','quote','splitQuote','cottageListing','cta','map','notice','steps','locationMap','reviews']),
  theme: z.enum(['auto','cream','paper','green']).optional(),
  width: z.enum(['narrow','standard','wide']).optional(),
  eyebrow: z.string().optional(),
  title: z.string(),
  text: z.string().optional(),
  image: z.string().optional(),
  imageAlt: z.string().optional(),
  imageCaption: z.string().optional(),
  imagePosition: z.enum(['left','right']).optional(),
  showCottagePreviewStrip: z.boolean().optional(),
  autoRotate: z.boolean().optional(),
  reviews: z.array(reviewItem).optional(),
  items: z.array(sectionItem).optional(),
  detailCardVariant: z.enum(['event','cause']).optional(),
  detailItems: z.array(detailCardItem).optional(),
  listItems: z.array(z.string()).optional(),
  galleryImages: z.array(z.object({
  ...translatedTextFields,
    image:z.string(),
    alt:z.string().optional(),
    caption:z.string().optional(),
    category:z.enum(['cottages','interiors','gardens','guernsey']).optional()
  })).optional(),
  quote: z.string().optional(),
  attribution: z.string().optional(),
  buttonLabel: z.string().optional(),
  buttonUrl: z.string().optional(),
  buttonExternal: z.boolean().optional(),
  secondaryButtonLabel: z.string().optional(),
  secondaryButtonUrl: z.string().optional(),
  secondaryButtonExternal: z.boolean().optional()
});

const cottageSectionImage = z.object({
  ...translatedTextFields,
  image: z.string(),
  alt: z.string().min(1),
  caption: z.string().optional()
});

const cottageSection = z.object({
  ...translatedTextFields,
  title: z.string(),
  description: z.string(),
  images: z.array(cottageSectionImage).min(1).max(4)
});

const cottages = defineCollection({ loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/cottages' }), schema: z.object({
  ...translatedTextFields,
  name:z.string(), slug:z.string(), eyebrow:z.string().optional(), tagline:z.string(), summary:z.string(), available:z.boolean(),
  sleeps:z.number(), bedrooms:z.number(), beds:z.number(), bathrooms:z.number(), season:z.string().optional(), dogFriendly:z.boolean(), airbnbUrl:z.string().url().optional(),
  heroMediaType:z.enum(['image','video']).optional(), heroImage:z.string(), heroAlt:z.string(), heroPan:z.boolean().optional(), heroVideo:z.string().optional(), heroPoster:z.string().optional(),
  sections:z.array(cottageSection).optional(),
  reviews:z.array(reviewItem).optional(),
  reviewAutoRotate:z.boolean().optional(), reviewIntervalSeconds:z.number().optional(),
  gallery:z.array(z.object({
  ...translatedTextFields,image:z.string(),alt:z.string(),caption:z.string()})), facilities:z.array(z.string()),
  highlights:z.array(z.object({
  ...translatedTextFields,title:z.string(),text:z.string()})).optional(), review:z.object({
  ...translatedTextFields,quote:z.string(),guest:z.string(),sourceUrl:z.string().url()}).optional(), seo
})});

const pages = defineCollection({ loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/pages' }), schema: z.object({
  ...translatedTextFields,
  title:z.string(), urlStub:z.string(), eyebrow:z.string().optional(), intro:z.string(), ...heroFields,
  reviews:z.array(reviewItem).optional(), reviewAutoRotate:z.boolean().optional(), reviewIntervalSeconds:z.number().optional(), sections:z.array(pageSection).optional(), seo
}) });

const subpages = defineCollection({ loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/subpages' }), schema: z.object({
  ...translatedTextFields,
  title:z.string(), slug:z.string(), eyebrow:z.string().optional(), intro:z.string(), published:z.boolean(),
  showInNavigation:z.boolean().optional(), navigationLabel:z.string().optional(), navigationOrder:z.number().optional(),
  ...heroFields,
  sections:z.array(pageSection), seo
}) });

export const collections = { cottages, pages, subpages };
