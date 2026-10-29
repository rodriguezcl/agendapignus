"""Refresh public reference data. No customer data or credentials are sent.

Run with Python 3; review the resulting diff before deploying. A failed source
aborts the update, preserving the last verified snapshot.
"""
import concurrent.futures
import datetime
import html
import io
import json
import pathlib
import re
import unicodedata
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
GEOREF = 'https://apis.datos.gob.ar/georef/api/localidades?provincia=14&max=5000&campos=id,nombre,departamento'
BCRA = 'https://www.bcra.gob.ar/api/endpoints/entidades-financieras.php?action=list&lang=es'
CAPITAL = 'https://gobiernoabierto.cordoba.gob.ar/datos/recurso/18854/Barrio_1.kmz'
WFS = 'https://idecor-ws.mapascordoba.gob.ar/geoserver/idecor/ows?'
# Jesús María's layer currently publishes abbreviations rather than full names;
# do not invent their expansion. This snapshot does not claim province-wide coverage.
LAYERS = [
    ('Anisacate', 'anisacate_barrios', 'nombre'),
    ('Colonia Caroya', 'ccaroya_barrios', 'nombre'),
    ('Corralito', 'corralito_barrios', 'nombre'),
    ('Cosquín', 'cosquin_barrios', 'nombre'),
    ('Hernando', 'hernando_barrios', 'nombre'),
    ('La Falda', 'barrios_lf', 'nombre_bar'),
    ('Morteros', 'mteros_barrios', 'name'),
    ('Salsipuedes', 'barrios_salsipuedes', 'completo'),
    ('Unquillo', 'unq_barrios', 'nombre'),
    ('Villa Allende', 'va_barrios', 'nombre'),
    ('Villa Giardino', 'Villa_Giardino_Barrios', 'nombre'),
    ('Villa María', 'vm_barrios', 'nombre'),
]

def read(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'PignusReferenceCatalog/1.0'}), timeout=45) as response:
        return response.read()

def key(value):
    return ''.join(c for c in unicodedata.normalize('NFD', value.lower()) if unicodedata.category(c) != 'Mn')

def title(value):
    return ' '.join(str(value).strip().split()).title()

def unique(values):
    return sorted({key(title(v)): title(v) for v in values if str(v or '').strip()}.values(), key=key)

def layer_data(args):
    city, layer, field = args
    url = WFS + urllib.parse.urlencode(dict(service='WFS', version='2.0.0', request='GetFeature', typeNames='idecor:'+layer, outputFormat='application/json', propertyName=field, count=5000))
    data = json.loads(read(url))
    names = unique(f['properties'][field] for f in data['features'])
    assert names and len(data['features']) < 5000, city
    return city, {'names': names, 'source': url, 'coverage': 'Catálogo publicado por IDECOR; puede no incluir urbanizaciones recientes.'}

def main():
    localities = json.loads(read(GEOREF))
    assert 400 < localities['cantidad'] < 5000
    cities = [{'id': c['id'], 'name': title(c['nombre']), 'department': title(c['departamento']['nombre'])} for c in localities['localidades']]
    # Georef includes component and aggregate entries with the same locality and
    # department. Keep the aggregate (shortest identifier) once in the selector.
    cities = list({(key(c['name']), key(c['department'])): c for c in sorted(cities, key=lambda c:len(c['id']), reverse=True)}.values())
    for city in cities:
        city['label'] = city['name'] + (' · '+city['department'] if sum(c['name'] == city['name'] for c in cities) > 1 else '')
    entities = json.loads(read(BCRA))
    assert entities['success'] and entities['disponible']
    banks = [{'code': e['codigo'][-3:], 'name': e['nombre'].strip()} for e in entities['entidades'] if int(e['codigo']) > 0 and int(e['codigo']) < 1000]
    assert len(banks) > 50 and len({b['code'] for b in banks}) == len(banks)
    kmz = zipfile.ZipFile(io.BytesIO(read(CAPITAL)))
    root = ET.fromstring(kmz.read('doc.kml'))
    names = []
    for description in root.findall('.//{http://www.opengis.net/kml/2.2}description'):
        match = re.search(r'<td>\s*Nombre\s*</td>\s*<td>(.*?)</td>', description.text or '', re.S | re.I)
        if match:
            names.append(html.unescape(match[1]))
    assert len(names) > 400
    neighborhoods = {'Córdoba': {'names': unique(names), 'source': CAPITAL, 'license': 'CC-BY-SA-AR (CBA)', 'coverage': 'Catastro municipal, publicación 2023. Incluye barrios oficiales y no oficiales.'}}
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        neighborhoods.update(dict(pool.map(layer_data, LAYERS)))
    by_id = {}
    for city_name, data in neighborhoods.items():
        matches = [c for c in cities if key(c['name']) == key(city_name)]
        assert len(matches) == 1, (city_name, matches)
        by_id[matches[0]['id']] = data
    snapshot = {'retrievedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'citySource': GEOREF, 'bankSource': BCRA, 'bankPublishedAt': entities.get('fecha_actualizacion'), 'cities': sorted(cities, key=lambda c:key(c['label'])), 'banks': sorted(banks, key=lambda b:b['name']), 'neighborhoods': by_id}
    target = ROOT / 'shared/registration/catalog-data.mjs'
    target.write_text('// Generated by scripts/update-registration-catalogs.py; public reference data only.\nexport default '+json.dumps(snapshot, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(f"Catalog: {len(cities)} localities, {len(by_id)} locality neighborhood lists, {sum(len(n['names']) for n in by_id.values())} neighborhoods, {len(banks)} financial institutions.")

if __name__ == '__main__':
    main()
