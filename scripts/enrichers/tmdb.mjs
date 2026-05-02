// Movies & TV — TMDB (free API key required: process.env.TMDB_API_KEY)
import { fetchJson, rateLimit } from '../lib/utils.mjs';

const KEY = () => process.env.TMDB_API_KEY;
const IMG = 'https://image.tmdb.org/t/p/w500';

async function tmdb(path, params = {}) {
  const u = new URL(`https://api.themoviedb.org/3${path}`);
  u.searchParams.set('api_key', KEY());
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  await rateLimit('themoviedb.org', 200);
  return fetchJson(u.toString());
}

export async function enrichMovie(item) {
  if (!KEY()) return {};
  let movie;
  if (item.overrideId) {
    movie = await tmdb(`/movie/${item.overrideId}`);
  } else {
    if (!item.title) return {};
    const params = { query: item.title };
    if (item.year) params.year = String(item.year);
    const search = await tmdb('/search/movie', params);
    const id = search.results?.[0]?.id;
    if (!id) return {};
    movie = await tmdb(`/movie/${id}`);
  }
  return {
    year: movie.release_date ? Number(movie.release_date.slice(0, 4)) : null,
    runtime: movie.runtime ? `${movie.runtime} min` : null,
    genre: (movie.genres || []).map(g => g.name),
    description: movie.overview || null,
    _coverUrl: movie.poster_path ? `${IMG}${movie.poster_path}` : null
  };
}

export async function enrichTv(item) {
  if (!KEY()) return {};
  let show;
  if (item.overrideId) {
    show = await tmdb(`/tv/${item.overrideId}`);
  } else {
    if (!item.title) return {};
    const params = { query: item.title };
    if (item.year) params.first_air_date_year = String(item.year);
    const search = await tmdb('/search/tv', params);
    const id = search.results?.[0]?.id;
    if (!id) return {};
    show = await tmdb(`/tv/${id}`);
  }
  return {
    year: show.first_air_date ? Number(show.first_air_date.slice(0, 4)) : null,
    network: show.networks?.[0]?.name || null,
    seasons: show.number_of_seasons || null,
    episodes: show.number_of_episodes || null,
    genre: (show.genres || []).map(g => g.name),
    description: show.overview || null,
    _coverUrl: show.poster_path ? `${IMG}${show.poster_path}` : null
  };
}
