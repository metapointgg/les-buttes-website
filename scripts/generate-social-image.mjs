import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const source = path.resolve('src/assets/images/les-buttes-about-hero.jpg');
const outputDirectory = path.resolve('public/social');
const output = path.join(outputDirectory, 'les-buttes-social.jpg');

await mkdir(outputDirectory, { recursive: true });

await sharp(source)
  .rotate()
  .resize(1200, 630, { fit: 'cover', position: 'centre' })
  .jpeg({ quality: 86, progressive: true, mozjpeg: true })
  .toFile(output);

console.log(`Generated social sharing image: ${output}`);
