import test from 'node:test';
import assert from 'node:assert/strict';
import { makeJobSnapshot, resolveJobComicStyle } from '../src/jobs.js';

test('job snapshots preserve Manga Lai in the queued settings', () => {
  const job=makeJobSnapshot({name:'Chap 1',pages:[],scenes:[],settings:{comicStyle:'hybrid',webtoonWidthPct:75},voice:null,outDir:'',fileName:'chap-1'});
  assert.equal(resolveJobComicStyle(job.settings,'manga'),'hybrid');
  assert.equal(job.settings.webtoonWidthPct,75);
});

test('legacy queued jobs without comic style inherit the current Manga Lai preference', () => {
  assert.equal(resolveJobComicStyle({},'hybrid'),'hybrid');
  assert.equal(resolveJobComicStyle({comicStyle:'manhwa'},'hybrid'),'manhwa');
  assert.equal(resolveJobComicStyle({},'invalid'),'manga');
});
