import sqlite3

src = sqlite3.connect('data/linshe/agent.db')
src.row_factory = sqlite3.Row
dst = sqlite3.connect('upstream/linshe/agent-core/data/agent.db')

rows = src.execute('SELECT * FROM characters WHERE id IN (5, 8)').fetchall()
cols = [d[0] for d in src.execute('SELECT * FROM characters LIMIT 1').description]

for r in rows:
    data = dict(r)
    cid = data['id']
    cname = data['name']
    exists = dst.execute('SELECT id FROM characters WHERE id = ?', (cid,)).fetchone()
    if exists:
        print('Character', cid, 'already exists in dst')
    else:
        dst_cols = [d[1] for d in dst.execute('PRAGMA table_info(characters)').fetchall()]
        common_cols = [c for c in cols if c in dst_cols]
        placeholders = ', '.join(['?'] * len(common_cols))
        col_names = ', '.join(common_cols)
        sql = f'INSERT INTO characters ({col_names}) VALUES ({placeholders})'
        values = [data[c] for c in common_cols]
        dst.execute(sql, values)
        print('Inserted character', cid, cname, 'into dst')

dst.commit()
print('Done!')
