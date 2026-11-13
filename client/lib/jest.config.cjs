module.exports = {
    testEnvironment: "jsdom",
    testMatch: ["<rootDir>/src/**/*.test.ts"],
    transform: { "^.+\\.tsx?$": ["ts-jest", { tsconfig: { noUnusedLocals: false, noUnusedParameters: false } }] },
    moduleNameMapper: { "^raw-loader!.*$": "<rootDir>/src/test/workletStub.ts" },
    clearMocks: true,
};
