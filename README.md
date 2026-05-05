# mcp-youtube-data

MCP server for the YouTube Data API v3. Research competitors, track trending videos, and pull channel/video statistics directly from Claude Code.

## Tools

| Tool | Description | Quota Cost |
|------|-------------|-----------|
| `search_videos` | Search YouTube with filters | **100 units** |
| `get_video_stats` | Views, likes, comments, duration for one video | ~5 units |
| `get_channel_stats` | Subscribers, total views, video count | ~5 units |
| `get_trending_videos` | Current trending chart for a region/category | ~5 units |

## Free Tier Limits

| Metric | Limit |
|--------|-------|
| Default quota | **10,000 units/day** |
| Quota reset | Midnight Pacific Time daily |
| `search.list` cost | **100 units per call** |
| `videos.list` cost | **~1-5 units per call** |
| `channels.list` cost | **~1-5 units per call** |
| Trending chart (`videos.list?chart=mostPopular`) | **~5 units per call** |

**Effective budget breakdown:** With 10,000 units/day:
- 100 video/channel stat lookups (1-5 units each) OR
- 100 searches (100 units each) — use searches sparingly

Request a quota increase at Google Cloud Console (free, takes 1-6 weeks approval).

## API Key Setup

1. Go to **https://console.cloud.google.com/**
2. Create or select a project
3. Enable **YouTube Data API v3**
4. Credentials → Create API Key
5. (Optional but recommended) Restrict the key to YouTube Data API only

## Environment Variables

```bash
YOUTUBE_API_KEY=AIzaSy...your_key_here
```

## Install

```bash
cd mcp-youtube-data
npm install
npm run build
```

## Claude Code `.mcp.json` Config

```json
{
  "mcpServers": {
    "youtube": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-youtube-data/dist/index.js"],
      "env": {
        "YOUTUBE_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

## Example Prompts

```
Search YouTube for "Claude Code tutorial" videos, sorted by view count, last 30 days
```

```
Get stats for video ID dQw4w9WgXcQ — views, likes, comments
```

```
What are the trending videos in Pakistan right now? (region_code: PK)
```

```
Get channel stats for channel ID UC...
```

## Video Categories for Trending

| ID | Category |
|----|----------|
| 10 | Music |
| 20 | Gaming |
| 22 | People & Blogs |
| 24 | Entertainment |
| 25 | News & Politics |
| 26 | How-to & Style |
| 28 | Science & Technology |

## Quota Conservation Tips

1. Use `get_trending_videos` (5 units) for daily trend research instead of `search_videos` (100 units)
2. Cache video IDs from search, then use `get_video_stats` to pull fresh metrics
3. `published_after` filter on search reduces irrelevant results, saving follow-up calls
4. For channel research, look up channel IDs once and store them — `get_channel_stats` is cheap

## How I Built This — Channel 1 Angle

**Video idea:** *"I use the YouTube API to spy on competitors — here's exactly how"*

The `get_trending_videos` tool costs only 5 quota units vs 100 for a search — that's 200 trending lookups per day for free. The insight: YouTube's trending chart is one of the best free signals for what's about to go viral. Check it daily for your target categories and region, feed the results to Claude for pattern analysis, and you have a free trend prediction system.

The quota management story is also compelling: 10,000 units sounds like a lot until you realize search costs 100 each. This MCP explicitly warns Claude Code when it's calling an expensive operation, which is a design pattern worth a dedicated video.

## License

MIT — see [LICENSE](LICENSE)
