import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const seo = z.object({ title: z.string(), description: z.string() });
const heroFields = {
  heroMediaType: z.enum(['image','video']).optional(),
  heroImage: z.string().optional(),
  heroAlt: z.string().optional(),
  heroPan: z.boolean().optional(),
  heroVideo: z.string().optional(),
  heroPoster: z.string().optional()
};

const sectionItem = z.object({
  kicker: z.string().optional(),
  title: z.string(),
  text: z.string().optional(),
  icon: z.enum(['arrow','bed','bath','guests','phone','mail','pin','external','menu','beach','walk','guernsey','history','islands','food']).optional(),
  linkLabel: z.string().optional(),
  linkUrl: z.string().optional(),
  external: z.boolean().optional()
});

const pageSection = z.object({
  enabled: z.boolean().optional(),
  type: z.enum(['text','feature','image','cards','iconCards','list','gallery','quote','splitQuote','cottageListing','cta','map','notice','steps','locationMap']),
  theme: z.enum(['auto','cream','paper','green']).optional(),
  width: z.enum(['narrow','standard','wide']).optional(),
  eyebrow: z.string().optional(),
  title: z.string(),
  text: z.string().optional(),
  image: z.string().optional(),
  imageAlt: z.string().optional(),
  imageCaption: z.string().optional(),
  imagePosition: z.enum(['left','right']).optional(),
  items: z.array(sectionItem).optional(),
  listItems: z.array(z.string()).optional(),
  galleryImages: z.array(z.object({ image:z.string(), alt:z.string().optional(), caption:z.string().optional() })).optional(),
  quote: z.string().optional(),
  attribution: z.string().optional(),
  buttonLabel: z.string().optional(),
  buttonUrl: z.string().optional(),
  buttonExternal: z.boolean().optional(),
  secondaryButtonLabel: z.string().optional(),
  secondaryButtonUrl: z.string().optional(),
  secondaryButtonExternal: z.boolean().optional()
});

const cottages = defineCollection({ loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/cottages' }), schema: z.object({
  name:z.string(), slug:z.string(), eyebrow:z.string(), tagline:z.string(), summary:z.string(), available:z.boolean(),
  sleeps:z.number(), bedrooms:z.number(), beds:z.number(), bathrooms:z.number(), dogFriendly:z.boolean(), airbnbUrl:z.string().url().optional(),
  heroMediaType:z.enum(['image','video']).optional(), heroImage:z.string(), heroAlt:z.string(), heroPan:z.boolean().optional(), heroVideo:z.string().optional(), heroPoster:z.string().optional(),
  gallery:z.array(z.object({image:z.string(),alt:z.string(),caption:z.string()})), facilities:z.array(z.string()),
  highlights:z.array(z.object({title:z.string(),text:z.string()})), review:z.object({quote:z.string(),guest:z.string(),sourceUrl:z.string().url()}).optional(), seo
})});

const pages = defineCollection({ loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/pages' }), schema: z.object({
  title:z.string(), urlStub:z.string(), eyebrow:z.string(), intro:z.string(), ...heroFields,
  sections:z.array(pageSection).optional(), seo
}) });

const subpages = defineCollection({ loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/subpages' }), schema: z.object({
  title:z.string(), slug:z.string(), eyebrow:z.string(), intro:z.string(), published:z.boolean(),
  showInNavigation:z.boolean().optional(), navigationLabel:z.string().optional(), navigationOrder:z.number().optional(),
  ...heroFields,
  sections:z.array(pageSection), seo
}) });

export const collections = { cottages, pages, subpages };
