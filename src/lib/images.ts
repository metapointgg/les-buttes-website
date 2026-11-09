import type { ImageMetadata } from 'astro';
const images = import.meta.glob<{ default: ImageMetadata }>('/src/assets/images/**/*.{jpeg,jpg,png,webp,avif,svg}', { eager: true });
export function getImage(path:string):ImageMetadata { const image=images[path]?.default; if(!image) throw new Error(`Image not found: ${path}`); return image; }
