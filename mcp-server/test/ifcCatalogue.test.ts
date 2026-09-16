import { splitPath, validateColumns, type Catalogue } from '../src/ifc/catalogue';

const catalogue: Catalogue = {
  totalProducts: 120,
  productsWithProperties: 120,
  types: [
    {
      type: 'IfcColumn',
      elementCount: 120,
      withProperties: 120,
      psets: [
        {
          name: 'Tekla Quantity',
          properties: [
            { name: 'Weight', count: 120, sample: 1228.96, valueType: 'number' },
            { name: 'Net surface area', count: 120, sample: 18.7, valueType: 'number' },
          ],
        },
        {
          name: 'Pset_ColumnCommon',
          properties: [{ name: 'Reference', count: 120, sample: 'HEB300', valueType: 'string' }],
        },
      ],
    },
    {
      type: 'IfcSlab',
      elementCount: 70,
      withProperties: 70,
      psets: [
        {
          name: 'i-Theses TSB_PlateBase',
          properties: [{ name: 'Thickness', count: 70, sample: 320, valueType: 'number' }],
        },
      ],
    },
  ],
};

describe('splitPath', () => {
  it('splits on the last dot so pset names may contain spaces and hyphens', () => {
    expect(splitPath('Tekla Quantity.Weight')).toEqual({ pset: 'Tekla Quantity', property: 'Weight' });
    expect(splitPath('i-Theses TSB_PlateBase.Thickness')).toEqual({
      pset: 'i-Theses TSB_PlateBase',
      property: 'Thickness',
    });
  });

  it('rejects paths with no usable separator', () => {
    expect(splitPath('Weight')).toBeNull();
    expect(splitPath('.Weight')).toBeNull();
    expect(splitPath('Tekla Quantity.')).toBeNull();
  });
});

describe('validateColumns', () => {
  it('accepts plain attributes and known property paths', () => {
    expect(validateColumns(catalogue, 'IfcColumn', ['GlobalId', 'Name', 'Tekla Quantity.Weight'])).toBeNull();
  });

  it('accepts property names containing spaces', () => {
    expect(validateColumns(catalogue, 'IfcColumn', ['Tekla Quantity.Net surface area'])).toBeNull();
  });

  // ifc-lite answers an unknown pset with blanks rather than an error, so a
  // hallucinated standard name would otherwise read as "this model has no
  // volumes" instead of "that pset does not exist here".
  it('rejects a plausible but absent standard pset', () => {
    const msg = validateColumns(catalogue, 'IfcColumn', ['Qto_ColumnBaseQuantities.GrossVolume']);
    expect(msg).toContain('Qto_ColumnBaseQuantities.GrossVolume');
    expect(msg).toContain('Tekla Quantity.Weight');
  });

  it('rejects a property that exists on another type only', () => {
    expect(validateColumns(catalogue, 'IfcColumn', ['i-Theses TSB_PlateBase.Thickness'])).toContain('Unknown column');
    expect(validateColumns(catalogue, 'IfcSlab', ['i-Theses TSB_PlateBase.Thickness'])).toBeNull();
  });

  it('reports every unknown column at once, and only the unknown ones', () => {
    const msg = validateColumns(catalogue, 'IfcColumn', ['Tekla Quantity.Weight', 'Bogus.One', 'Bogus.Two']) ?? '';
    // The valid column still appears further down under "Available:", so the
    // assertion has to look at the rejected list rather than the whole message.
    const rejected = msg.slice(0, msg.indexOf('Available:'));
    expect(rejected).toContain('Bogus.One');
    expect(rejected).toContain('Bogus.Two');
    expect(rejected).not.toContain('Tekla Quantity.Weight');
  });

  it('says so plainly when the type carries no property sets', () => {
    const empty: Catalogue = {
      totalProducts: 976,
      productsWithProperties: 0,
      types: [{ type: 'IfcReinforcingBar', elementCount: 976, withProperties: 0, psets: [] }],
    };
    expect(validateColumns(empty, 'IfcReinforcingBar', ['Anything.At all'])).toContain(
      'carries no property sets',
    );
  });
});
