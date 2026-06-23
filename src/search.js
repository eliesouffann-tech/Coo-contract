import axios from "axios";

export async function webSearch(query) {
  if (process.env.BRAVE_SEARCH_API_KEY) {
    return braveSearch(query);
  }
  return duckduckgoSearch(query);
}

async function braveSearch(query) {
  const { data } = await axios.get("https://api.search.brave.com/res/v1/web/search", {
    params: { q: query, count: 5, text_decorations: false },
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY,
    },
    timeout: 8000,
  });
  return {
    results: (data.web?.results ?? []).slice(0, 5).map((r) => ({
      title: r.title,
      url: r.url,
      description: r.description,
    })),
  };
}

async function duckduckgoSearch(query) {
  const { data } = await axios.get("https://api.duckduckgo.com/", {
    params: { q: query, format: "json", no_html: 1, skip_disambig: 1 },
    timeout: 8000,
  });
  const results = [];
  if (data.AbstractText) {
    results.push({ title: data.Heading, description: data.AbstractText, url: data.AbstractURL });
  }
  for (const t of (data.RelatedTopics ?? []).slice(0, 4)) {
    if (t.Text) results.push({ title: t.Text.split(" - ")[0], description: t.Text, url: t.FirstURL });
  }
  return { results: results.slice(0, 5) };
}
