---
name: prompt-optimizer
description: Use when asked to optimize, improve, or expand an image prompt idea. Takes a rough concept and asks clarifying questions to produce a detailed, high-quality image generation prompt.
---

# Prompt Optimizer

Turn a rough image idea into a polished, detailed generation prompt through guided clarification.

## Step 1 — Extract the core idea

The user's rough idea comes from the command args. If nothing was passed, ask:
> "What's your image idea? Describe it briefly."

## Step 2 — Ask clarifying questions

Use `AskUserQuestion` with all 4 questions at once:

**Q1 — Art style:**
- Photorealistic — hyper-detailed photography
- 16-bit pixel art — retro game aesthetic
- Oil painting — rich textured brushwork
- Watercolor — soft washes, paper texture
- Anime / manga — stylized Japanese illustration
- Cinematic concept art — film production art, dramatic

**Q2 — Aspect ratio:**
- 16:9 landscape — widescreen, cinematic
- 1:1 square — balanced composition, social media
- 9:16 portrait — vertical, phone wallpaper

**Q3 — Mood & atmosphere:**
- Epic & dramatic — grand scale, awe-inspiring
- Peaceful & serene — calm, soft, inviting
- Mysterious & dark — shadows, tension, intrigue
- Whimsical & playful — fun, colorful, lighthearted
- Cinematic & intense — high contrast, action feel

**Q4 — Lighting:**
- Golden hour — warm orange/amber, long shadows
- Midday — bright, high contrast, vivid colors
- Blue hour / twilight — cool purples and blues, magical
- Night — moonlight, stars, dramatic shadows
- Overcast — soft diffused light, even tones

## Step 3 — Build the optimized prompt

Synthesize the answers into a single polished prompt using this structure:

```
[Subject + action + setting], [style descriptors], [lighting], [atmosphere/mood], [technical quality tags], [aspect ratio note if 16:9 or 9:16]
```

### Style-specific quality tags to append:

| Style | Quality tags |
|---|---|
| Photorealistic | `hyperrealistic, 8K, sharp focus, ray tracing, professional photography` |
| 16-bit pixel art | `16-bit pixel art, retro game sprite, clean pixel edges, limited color palette` |
| Oil painting | `oil on canvas, impasto texture, rich brushwork, museum quality` |
| Watercolor | `loose watercolor washes, paper grain, soft edges, ink linework` |
| Anime / manga | `anime illustration, clean lineart, cel shading, vibrant colors, manga style` |
| Cinematic concept art | `cinematic concept art, matte painting, film production design, dramatic composition` |

### Lighting descriptors:

| Lighting | Descriptors |
|---|---|
| Golden hour | `golden hour lighting, warm amber tones, long shadows, backlit` |
| Midday | `bright midday sun, high contrast, vivid saturated colors` |
| Blue hour / twilight | `blue hour, twilight sky, cool purple hues, magical atmosphere` |
| Night | `moonlit, starry sky, deep shadows, dramatic night scene` |
| Overcast | `soft overcast light, diffused shadows, muted tones, even exposure` |

### Mood amplifiers:

| Mood | Amplifiers |
|---|---|
| Epic & dramatic | `epic scale, awe-inspiring, grand composition, sweeping vista` |
| Peaceful & serene | `tranquil, soft colors, gentle, idyllic` |
| Mysterious & dark | `moody, dark atmosphere, dramatic shadows, mysterious` |
| Whimsical & playful | `whimsical, colorful, playful, magical, cheerful` |
| Cinematic & intense | `cinematic, high contrast, tense atmosphere, dynamic angle` |

## Step 4 — Output

Present the optimized prompt in a code block so it's easy to copy, followed by a one-line explanation of the key choices made:

```
[the full optimized prompt]
```

Then offer to generate it: if an image-generation skill or tool is available in this session, offer to run the prompt with it; otherwise suggest pasting it into the user's image generator of choice.

## Example

Input: `"dragon on a mountain"`

After answers: pixel art / 16:9 / epic & dramatic / golden hour

Output:
```
a mighty dragon perched atop a jagged mountain peak surveying a vast fantasy landscape, 16-bit pixel art, retro game aesthetic, clean pixel edges, limited color palette, golden hour lighting, warm amber tones, long shadows, epic scale, awe-inspiring, grand composition, in 16:9 aspect ratio
```
