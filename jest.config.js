require("dotenv").config({ path: ".test.env" });
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    verbose: true,
    testRegex: "(/__tests__/.*|(\\.|/)(test|spec))\\.(tsx?)$",
    transform: {
        "^.+\\.tsx?$": "ts-jest"
    },
    testPathignorePatterns: [
        "src/__tests__/config.ts"
    ]
};

//   "jest": {
//     "verbose": true,
//     "testEnvironment": "node",
//     "transform": {
//       "^.+\\.tsx?$": "ts-jest"
//     },
//     "testRegex": "(/__tests__/.*|(\\.|/)(test|spec))\\.(tsx?)$",
//     "moduleFileExtensions": [
//       "ts",
//       "tsx",
//       "json",
//       "node"
//     ]
//   }
