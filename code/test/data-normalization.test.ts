import { describe, expect, it } from '@jest/globals';
import { createMockEvent, ExternalSystemItem } from '@devrev/airsync-sdk';

import { denormalizeTodo } from '../src/functions/external-system/data-denormalization';
import { normalizeAttachment, normalizeTodo } from '../src/functions/external-system/data-normalization';
import { HttpClient } from '../src/functions/external-system/http-client';
import mapping from '../src/functions/external-system/initial_domain_mapping.json';
import { ExternalTodo } from '../src/functions/external-system/types';

const todo: ExternalTodo = {
  id: 'todo-1',
  created_date: '2026-01-01T00:00:00Z',
  modified_date: '2026-01-01T00:00:00Z',
  title: 'Test todo',
  body: '<p>Hello <strong>world</strong> &amp; <a href="https://example.com">friends</a>.</p>',
  creator: 'user-1',
  owner: 'user-1',
};

describe('Todo rich text', () => {
  it('converts HTML to the rich-text Markdown array expected by AirSync', () => {
    expect(normalizeTodo(todo).data).toMatchObject({
      body: ['Hello **world** & [friends](https://example.com).'],
    });
    expect(mapping.additional_mappings.record_type_mappings.todos
      .possible_record_type_mappings[0].shard.stock_field_mappings.body
      .transformation_method_for_set.transformation_method).toBe('use_rich_text');
  });

  it('preserves paragraphs and lists', () => {
    expect(normalizeTodo({ ...todo, body: '<p>First</p><p>Second</p><ul><li>One</li><li>Two</li></ul>' }).data)
      .toMatchObject({ body: ['First\n\nSecond\n\n*   One\n*   Two'] });
  });

  it('accepts an empty body', () => {
    expect(normalizeTodo({ ...todo, body: '' }).data).toMatchObject({ body: [''] });
  });

  it('converts reverse-sync rich text back to HTML', () => {
    const item = {
      ...todo,
      id: { devrev: 'work-1' },
      data: { ...todo, body: { type: 'rich_text', content: ['Hello **world**.'] } },
    } as ExternalSystemItem;
    expect(denormalizeTodo(item).body).toBe('<p>Hello <strong>world</strong>.</p>\n');
  });

  it('preserves legacy string bodies when loading', () => {
    const item = { ...todo, id: { devrev: 'work-1' }, data: todo } as ExternalSystemItem;
    expect(denormalizeTodo(item).body).toBe(todo.body);
  });
});

describe('Todo attachment fixtures', () => {
  it('produces downloadable, non-inline attachments linked to their todos', async () => {
    const client = new HttpClient(createMockEvent('http://localhost:3001'));
    const attachments = (await client.getAttachments()).map(normalizeAttachment);
    expect(attachments).toHaveLength(2);
    expect(attachments.map((item) => item.parent_id)).toEqual(['todo-1', 'todo-5']);
    for (const attachment of attachments) {
      expect(attachment.inline).toBe(false);
      expect(attachment.url).toMatch(/^https:\/\/raw\.githubusercontent\.com\/devrev\/airsync-template\/[a-f0-9]{40}\/README\.md$/);
      expect(attachment.file_name).toBe('airsync-template-readme.md');
    }
  });
});
