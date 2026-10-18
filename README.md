# Jarvis Senpai

**"Jarvis for the factory floor."** An agentic AI copilot for small manufacturers — scan a raw-material tag with your phone and Senpai tracks it, predicts what's about to expire or run low, drafts the reorder, finds suppliers, and answers the floor by voice in any language.

Built for the **Google Cloud AI Builder Cup 2026** — Manufacturing: Intelligent Operations & Industrial Efficiency · **Team Artemis**.

🔗 Live app: https://jarvis-senpai.ai.studio (deployed on Google Cloud Run)

## The problem
Small manufacturers lose real money to materials that quietly expire, run out, or get reordered by hand — and they can't afford enterprise inventory software. Jarvis Senpai gives them an agentic copilot that runs on a phone.

## What it does
- **Scan → Inventory.** Point your phone at a material label. Gemini reads it (any language), computes the expiry date, and logs it to Firestore. If the image isn't a real label, it says so — it refuses to hallucinate (returns "No label detected", confidence 0) instead of inventing data.
- **Predict & Reorder.** Flags items expiring soon or below their safety threshold, explains why, and drafts a purchase order — a human always approves; nothing is placed automatically. It never invents a stock threshold without your input.
- **Supplier Search.** Finds seller options (local / Alibaba / Amazon) via Google Search grounding — real seller context, never fabricated prices.
- **Senpai Copilot.** A voice-first assistant with a live gradient orb — ask anything by voice or text in English, Hindi, or Kannada; it calls the right tool and answers aloud. The proactive "Bankai — Today" card greets you with what needs attention.
- **Batch History & Traceability.** Full provenance and usage log per batch / LOT.

## Built on Google Cloud
- **Gemini** — multimodal label reading and the Senpai copilot's reasoning + tool-calling
- **Google Search grounding** — supplier sourcing
- **Firebase** — Firestore (live data), Hosting, and Cloud Run deployment
- **Browser SpeechRecognition + SpeechSynthesis** — multilingual voice in/out

## Architecture
Four independent pipelines over one shared Firestore schema and a common agent tool contract (scanItem, predictAlerts, findSuppliers, draftOrder), unified by the Senpai voice copilot:
1. Scan & Inventory · 2. Predict & Reorder · 3. Supplier Search · 4. Senpai Copilot + Bankai digest

## Run locally
Prerequisites: Node.js
1. `npm install`
2. Set `GEMINI_API_KEY` in `.env.local`
3. `npm run dev`

## Team Artemis
Ranjitha Nayak (lead) · Amogh · Rohan · Aishwarya
