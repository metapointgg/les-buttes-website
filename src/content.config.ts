import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
const seo = z.object({ title: z.string(), description: z.string() });
const cottages = defineCollection({ loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/cottages' }), schema: z.object({
  name:z.string(), slug:z.string(), eyebrow:z.string(), tagline:z.string(), summary:z.string(), available:z.boolean(),
  sleeps:z.number(), bedrooms:z.number(), beds:z.number(), bathrooms:z.number(), dogFriendly:z.boolean(), airbnbUrl:z.string().url().optional(),
  heroMediaType:z.enum(['image','video']).optional(), heroImage:z.string(), heroAlt:z.string(), heroPan:z.boolean().optional(), heroVideo:z.string().optional(), heroPoster:z.string().optional(),
  gallery:z.array(z.object({image:z.string(),alt:z.string(),caption:z.string()})), facilities:z.array(z.string()),
  highlights:z.array(z.object({title:z.string(),text:z.string()})), review:z.object({quote:z.string(),guest:z.string(),sourceUrl:z.string().url()}).optional(), seo
})});
const pages = defineCollection({ loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/pages' }), schema: z.object({
  title:z.string(), urlStub:z.string(), eyebrow:z.string(), intro:z.string(), heroMediaType:z.enum(['image','video']).optional(), heroImage:z.string().optional(), heroAlt:z.string().optional(), heroPan:z.boolean().optional(), heroVideo:z.string().optional(), heroPoster:z.string().optional(),
  experienceImage:z.string().optional(), experienceImageAlt:z.string().optional(), experienceImagePan:z.boolean().optional(),
  welcomeEyebrow:z.string().optional(), welcomeTitle:z.string().optional(), welcomeQuote:z.string().optional(), welcomeNote:z.string().optional(), seo
}) });
export const collections = { cottages, pages };
