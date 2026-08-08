import { faker } from '@faker-js/faker';

export async function generateMockData(collection: any, count = 10) {
  const mockRows: any[] = [];
  
  for (let i = 0; i < count; i++) {
    const row: Record<string, any> = {};
    for (const [fieldName, field] of collection.fields) {
      if (field.primaryKey || field.autoIncrement) continue;
      
      const type = field.type;
      
      try {
        if (type === 'string') {
          row[fieldName] = faker.lorem.word();
        } else if (type === 'text') {
          row[fieldName] = faker.lorem.sentence();
        } else if (type === 'integer') {
          row[fieldName] = faker.number.int({ max: 1000 });
        } else if (type === 'float' || type === 'double' || type === 'decimal') {
          row[fieldName] = faker.number.float();
        } else if (type === 'boolean') {
          row[fieldName] = faker.datatype.boolean();
        } else if (type === 'date') {
          row[fieldName] = faker.date.recent();
        } else if (type === 'password') {
          row[fieldName] = faker.internet.password();
        } else if (type === 'uuid') {
          row[fieldName] = faker.string.uuid();
        } else if (field.isForeignKey || type.includes('relation') || type === 'belongsTo') {
          // If it's a required relation, try to get a random ID from the target collection.
          // This is a best effort approach.
          if (field.required && field.target) {
             const targetRepo = collection.db.getRepository(field.target);
             if (targetRepo) {
                // Pick a random row
                const randomTarget = await targetRepo.findOne({ order: collection.db.sequelize.random() });
                if (randomTarget) {
                  row[field.foreignKey || fieldName] = randomTarget[targetRepo.collection.model.primaryKeyAttributes[0]];
                }
             }
          }
        } else if (type === 'enum' || type === 'choices') {
          if (field.choices && field.choices.length > 0) {
             const randomChoice = faker.helpers.arrayElement(field.choices);
             row[fieldName] = randomChoice.value;
          }
        }
      } catch (err) {
        // Fallback for tricky fields
        console.warn(`Could not generate mock data for ${collection.name}.${fieldName}`, err.message);
      }
    }
    mockRows.push(row);
  }
  return mockRows;
}
