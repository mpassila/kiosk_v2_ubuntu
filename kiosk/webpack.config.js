// ... existing code ...
{
  devServer: {
    // Remove this if it exists
    // onBeforeSetupMiddleware: function (devServer) { ... }

    // Add this instead
    setupMiddlewares: (middlewares, devServer) => {
      // If you had any code in onBeforeSetupMiddleware, move it here
      return middlewares;
  }
}
// ... existing code ...