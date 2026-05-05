import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// YouTube Data API v3
// Default quota: 10,000 units/day (resets midnight Pacific)
// Quota costs: search.list = 100 units, videos.list = 1-5 units, channels.list = 1-5 units
const API_KEY = process.env.YOUTUBE_API_KEY;
const BASE_URL = "https://www.googleapis.com/youtube/v3";

function requireKey(): string {
  if (!API_KEY) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      "YOUTUBE_API_KEY not set. Enable YouTube Data API v3 and create a key at https://console.cloud.google.com/"
    );
  }
  return API_KEY;
}

async function ytFetch(endpoint: string, params: Record<string, string>): Promise<unknown> {
  const key = requireKey();
  const qs = new URLSearchParams({ key, ...params });
  const res = await fetch(`${BASE_URL}/${endpoint}?${qs}`);
  if (res.status === 403) {
    const body = await res.text();
    if (body.includes("quotaExceeded")) {
      throw new McpError(ErrorCode.InvalidRequest, "YouTube API quota exceeded (10,000 units/day). Resets at midnight Pacific. search.list costs 100 units per call.");
    }
    throw new McpError(ErrorCode.InvalidRequest, `YouTube API 403: ${body}`);
  }
  if (!res.ok) {
    throw new McpError(ErrorCode.InternalError, `YouTube API error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

const ORDERS = ["relevance", "date", "rating", "title", "viewCount"] as const;
const REGION_CODES = ["US", "GB", "PK", "IN", "CA", "AU", "DE", "FR", "JP"] as const;

// Category IDs: 10=Music, 20=Gaming, 22=People&Blogs, 24=Entertainment, 25=News, 26=How-to, 28=Science&Tech
const SearchVideosSchema = z.object({
  query: z.string().min(1).describe("Search query — costs 100 quota units per call"),
  max_results: z.number().int().min(1).max(50).default(10).describe("Max results (1-50)"),
  order: z.enum(ORDERS).default("relevance").describe("Sort order"),
  published_after: z.string().optional().describe("RFC 3339 datetime (e.g. 2026-01-01T00:00:00Z)"),
  published_before: z.string().optional().describe("RFC 3339 datetime"),
  region_code: z.string().length(2).optional().describe("ISO 3166-1 alpha-2 country code"),
  relevance_language: z.string().optional().describe("BCP-47 language code (e.g. en, ur)"),
  video_duration: z.enum(["any", "short", "medium", "long"]).optional()
    .describe("short=<4min, medium=4-20min, long=>20min"),
});

const GetVideoStatsSchema = z.object({
  video_id: z.string().min(1).describe("YouTube video ID (the 11-char string after ?v=)"),
});

const GetChannelStatsSchema = z.object({
  channel_id: z.string().min(1).describe("YouTube channel ID (starts with UC...)"),
});

const GetTrendingVideosSchema = z.object({
  region_code: z.string().length(2).default("US").describe("ISO 3166-1 alpha-2 country code"),
  category_id: z.string().optional().describe("YouTube video category ID (e.g. '28' for Science & Tech)"),
  max_results: z.number().int().min(1).max(50).default(20).describe("Number of trending videos"),
});

function formatVideo(item: Record<string, unknown>) {
  const snippet = item.snippet as Record<string, unknown> | undefined;
  const stats = item.statistics as Record<string, unknown> | undefined;
  const contentDetails = item.contentDetails as Record<string, unknown> | undefined;
  const id = typeof item.id === "object" ? (item.id as Record<string, unknown>).videoId : item.id;
  return {
    video_id: id,
    title: snippet?.title,
    channel: snippet?.channelTitle,
    channel_id: snippet?.channelId,
    published_at: snippet?.publishedAt,
    description: typeof snippet?.description === "string" ? snippet.description.slice(0, 300) : "",
    thumbnail: (snippet?.thumbnails as Record<string, unknown> | undefined)?.high,
    view_count: stats?.viewCount ? Number(stats.viewCount) : undefined,
    like_count: stats?.likeCount ? Number(stats.likeCount) : undefined,
    comment_count: stats?.commentCount ? Number(stats.commentCount) : undefined,
    duration: contentDetails?.duration,
    url: `https://youtube.com/watch?v=${id}`,
  };
}

const server = new Server(
  { name: "mcp-youtube-data", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_videos",
      description: "Search YouTube videos. WARNING: costs 100 quota units per call (daily limit: 10,000 units = 100 searches/day). Use sparingly.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          max_results: { type: "number", default: 10, minimum: 1, maximum: 50 },
          order: { type: "string", enum: ORDERS, default: "relevance" },
          published_after: { type: "string", description: "RFC 3339 datetime lower bound" },
          published_before: { type: "string", description: "RFC 3339 datetime upper bound" },
          region_code: { type: "string", description: "2-letter country code" },
          relevance_language: { type: "string", description: "BCP-47 language code" },
          video_duration: { type: "string", enum: ["any", "short", "medium", "long"] },
        },
        required: ["query"],
      },
    },
    {
      name: "get_video_stats",
      description: "Get view count, like count, comment count, and metadata for a YouTube video. Costs ~5 quota units.",
      inputSchema: {
        type: "object",
        properties: {
          video_id: { type: "string", description: "YouTube video ID (11-char string from URL)" },
        },
        required: ["video_id"],
      },
    },
    {
      name: "get_channel_stats",
      description: "Get subscriber count, total views, video count, and metadata for a YouTube channel. Costs ~5 quota units.",
      inputSchema: {
        type: "object",
        properties: {
          channel_id: { type: "string", description: "YouTube channel ID (starts with UC)" },
        },
        required: ["channel_id"],
      },
    },
    {
      name: "get_trending_videos",
      description: "Get currently trending videos in a region and optional category. Costs ~5 quota units.",
      inputSchema: {
        type: "object",
        properties: {
          region_code: { type: "string", default: "US", description: "2-letter country code (PK for Pakistan)" },
          category_id: { type: "string", description: "YouTube category ID (28=Science&Tech, 24=Entertainment)" },
          max_results: { type: "number", default: 20, minimum: 1, maximum: 50 },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    switch (name) {
      case "search_videos": {
        const input = SearchVideosSchema.parse(args);
        const params: Record<string, string> = {
          part: "snippet",
          type: "video",
          q: input.query,
          maxResults: String(input.max_results),
          order: input.order,
        };
        if (input.published_after) params.publishedAfter = input.published_after;
        if (input.published_before) params.publishedBefore = input.published_before;
        if (input.region_code) params.regionCode = input.region_code;
        if (input.relevance_language) params.relevanceLanguage = input.relevance_language;
        if (input.video_duration) params.videoDuration = input.video_duration;
        const data = await ytFetch("search", params) as Record<string, unknown>;
        const items = (data.items as Array<Record<string, unknown>>).map(formatVideo);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              total_results: (data.pageInfo as Record<string, unknown>)?.totalResults,
              quota_note: "This search cost 100 quota units. Daily limit: 10,000.",
              videos: items,
              next_page_token: data.nextPageToken,
            }, null, 2),
          }],
        };
      }

      case "get_video_stats": {
        const input = GetVideoStatsSchema.parse(args);
        const data = await ytFetch("videos", {
          part: "snippet,statistics,contentDetails",
          id: input.video_id,
        }) as Record<string, unknown>;
        const items = data.items as Array<Record<string, unknown>>;
        if (!items?.length) {
          throw new McpError(ErrorCode.InvalidRequest, `No video found with ID: ${input.video_id}`);
        }
        return {
          content: [{
            type: "text",
            text: JSON.stringify(formatVideo(items[0]), null, 2),
          }],
        };
      }

      case "get_channel_stats": {
        const input = GetChannelStatsSchema.parse(args);
        const data = await ytFetch("channels", {
          part: "snippet,statistics,brandingSettings",
          id: input.channel_id,
        }) as Record<string, unknown>;
        const items = data.items as Array<Record<string, unknown>>;
        if (!items?.length) {
          throw new McpError(ErrorCode.InvalidRequest, `No channel found with ID: ${input.channel_id}`);
        }
        const ch = items[0];
        const snippet = ch.snippet as Record<string, unknown>;
        const stats = ch.statistics as Record<string, unknown>;
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              channel_id: ch.id,
              title: snippet?.title,
              description: typeof snippet?.description === "string" ? snippet.description.slice(0, 400) : "",
              published_at: snippet?.publishedAt,
              country: snippet?.country,
              subscriber_count: stats?.subscriberCount ? Number(stats.subscriberCount) : "hidden",
              view_count: stats?.viewCount ? Number(stats.viewCount) : undefined,
              video_count: stats?.videoCount ? Number(stats.videoCount) : undefined,
              url: `https://youtube.com/channel/${ch.id}`,
            }, null, 2),
          }],
        };
      }

      case "get_trending_videos": {
        const input = GetTrendingVideosSchema.parse(args);
        const params: Record<string, string> = {
          part: "snippet,statistics,contentDetails",
          chart: "mostPopular",
          regionCode: input.region_code,
          maxResults: String(input.max_results),
        };
        if (input.category_id) params.videoCategoryId = input.category_id;
        const data = await ytFetch("videos", params) as Record<string, unknown>;
        const items = (data.items as Array<Record<string, unknown>>).map(formatVideo);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              region: input.region_code,
              count: items.length,
              trending_videos: items,
            }, null, 2),
          }],
        };
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (err) {
    if (err instanceof McpError) throw err;
    if (err instanceof z.ZodError) {
      throw new McpError(ErrorCode.InvalidParams, `Invalid parameters: ${err.message}`);
    }
    throw new McpError(ErrorCode.InternalError, `Unexpected error: ${String(err)}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("mcp-youtube-data server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
